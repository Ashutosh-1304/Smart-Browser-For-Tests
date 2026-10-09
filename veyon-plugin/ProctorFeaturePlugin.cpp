/*
 * ProctorFeaturePlugin.cpp
 *
 * See ProctorFeaturePlugin.h for the overall design. This file wires the two
 * Features and routes messages between Veyon's transport and the local hub.
 *
 * TODO(verify) markers: the FeatureMessage argument API and a couple of Master
 * UI calls are version-sensitive. Each is flagged inline so you can confirm the
 * exact signature against your installed Veyon headers before shipping.
 */
#include <QVariant>

#include "ProctorFeaturePlugin.h"
#include "ProctorBridgeClient.h"
#include "FeatureMessage.h"
#include "ComputerControlInterface.h"
#include "VeyonServerInterface.h"
#include "VeyonWorkerInterface.h"
#include "VeyonMasterInterface.h"

ProctorFeaturePlugin::ProctorFeaturePlugin( QObject* parent ) :
	QObject( parent ),
	// Flag feature: lives on BOTH Master and Service. It is not an "action" the
	// teacher clicks; it is a state channel that paints the thumbnail. Hence
	// Mode | Master | Service, no Action flag.
	m_flagFeature(
		QStringLiteral( "ProctorFlag" ),
		Feature::Flag::Mode | Feature::Flag::Master | Feature::Flag::Service,
		Feature::Uid( "b1d4e9a0-3c27-4f6b-8a51-7e9c2d4f6a83" ),
		Feature::Uid(),
		tr( "Proctoring Flag" ),
		{},
		tr( "Live proctoring violations and fairness score from Smart Browser" ) ),
	// Command feature: a teacher-triggered action on the Master that is sent to
	// the student. Action flag so it can appear as a button/menu entry.
	m_commandFeature(
		QStringLiteral( "ProctorCommand" ),
		Feature::Flag::Action | Feature::Flag::Master | Feature::Flag::Service,
		Feature::Uid( "c2e5f0b1-4d38-5a7c-9b62-8f0d3e5a7b94" ),
		Feature::Uid(),
		tr( "Lock Student Exam" ),
		tr( "Unlock Student Exam" ),
		tr( "Lock or warn the student's Smart Browser session" ) )
{
	m_features += m_flagFeature;
	m_features += m_commandFeature;

	// Decide our role. On the student PC the plugin is loaded inside the Service
	// / Worker; there we open the bridge to the local proctoring hub. On the
	// Master the bridge stays null. We can't reliably know the component in the
	// ctor, so the actual connection is lazily started from the Service-side
	// handleFeatureMessage()/controlFeature() path via initServiceSide().
}

ProctorFeaturePlugin::~ProctorFeaturePlugin()
{
	delete m_bridge;
}

const FeatureList& ProctorFeaturePlugin::featureList() const
{
	return m_features;
}

// ── Master side: start/stop the feature from the console ──────────────────────

bool ProctorFeaturePlugin::startFeature( VeyonMasterInterface& master,
                                         const Feature& feature,
                                         const ComputerControlInterfaceList& computerControlInterfaces )
{
	Q_UNUSED( master )

	if( feature.uid() == m_commandFeature.uid() )
	{
		// Teacher clicked the lock action in the Master for the selected
		// student(s). Send a "lock" command down to them.
		sendCommandToStudent( computerControlInterfaces,
		                      QStringLiteral( "lock" ),
		                      tr( "Your exam has been locked by the supervisor." ) );
		return true;
	}

	// The flag feature has no explicit "start" — it is driven by incoming
	// messages. Nothing to do here.
	return feature.uid() == m_flagFeature.uid();
}

bool ProctorFeaturePlugin::stopFeature( VeyonMasterInterface& master,
                                        const Feature& feature,
                                        const ComputerControlInterfaceList& computerControlInterfaces )
{
	Q_UNUSED( master )

	if( feature.uid() == m_commandFeature.uid() )
	{
		// Stopping the lock action == unlock the student.
		sendCommandToStudent( computerControlInterfaces,
		                      QStringLiteral( "unlock" ),
		                      QString() );
		return true;
	}
	return feature.uid() == m_flagFeature.uid();
}

// ── Generic control entry point (Initialize/Start/Stop on any component) ──────

bool ProctorFeaturePlugin::controlFeature( Feature::Uid featureUid,
                                           Operation operation,
                                           const QVariantMap& arguments,
                                           const ComputerControlInterfaceList& computerControlInterfaces )
{
	Q_UNUSED( arguments )
	Q_UNUSED( computerControlInterfaces )

	if( featureUid != m_flagFeature.uid() && featureUid != m_commandFeature.uid() )
	{
		return false;
	}

	// On the Service, Initialize is our cue to connect to the local hub so we
	// start forwarding the app's violations even before the teacher looks.
	if( operation == Operation::Initialize )
	{
		initServiceSide();
	}
	return true;
}

// ── Student (Service) side: bring up the local-hub client once ────────────────

void ProctorFeaturePlugin::initServiceSide()
{
	if( m_bridge )
	{
		return;
	}
	m_bridge = new ProctorBridgeClient( this );
	connect( m_bridge, &ProctorBridgeClient::violationReceived,
	         this, &ProctorFeaturePlugin::onProctorViolation );
	connect( m_bridge, &ProctorBridgeClient::scoreReceived,
	         this, &ProctorFeaturePlugin::onProctorScore );
	connect( m_bridge, &ProctorBridgeClient::sessionChanged,
	         this, &ProctorFeaturePlugin::onProctorSession );
	m_bridge->start( QStringLiteral( "ws://localhost:3001/proctor" ) );
}

// ── Student side: app events -> FeatureMessage up to the Master ───────────────
//
// NOTE: these slots run inside the Service. To push data to the Master we use
// the Worker/Service message channel. In most Veyon versions the Service holds
// the active connection to the Master and FeatureMessages flow over it.
//
// TODO(verify): the exact way to emit an unsolicited message from the Service
// to the Master differs by version (sendAsyncFeatureMessages vs. a server
// interface handle). Confirm against VeyonServerInterface.h. The packing of
// arguments below is the part the Master-side handler must mirror.

void ProctorFeaturePlugin::onProctorViolation( const QVariantMap& violation )
{
	FeatureMessage msg( m_flagFeature.uid(), ViolationUpdate );
	// TODO(verify): addArgument(key, value) is the common API; some versions use
	// a different setter. Keep keys stable — the Master handler reads them back.
	msg.addArgument( QStringLiteral( "kind" ),     violation.value( QStringLiteral( "kind" ) ) );
	msg.addArgument( QStringLiteral( "label" ),    violation.value( QStringLiteral( "label" ) ) );
	msg.addArgument( QStringLiteral( "message" ),  violation.value( QStringLiteral( "message" ) ) );
	msg.addArgument( QStringLiteral( "severity" ), violation.value( QStringLiteral( "severity" ) ) );
	msg.addArgument( QStringLiteral( "studentId" ),violation.value( QStringLiteral( "studentId" ) ) );

	// TODO(verify): replace with the correct "send to master" call for your
	// Veyon version, e.g. m_server->sendFeatureMessageReply(...) captured during
	// a prior handleFeatureMessage, or sendAsyncFeatureMessages().
	// sendFeatureMessageToMaster( msg );
}

void ProctorFeaturePlugin::onProctorScore( int total, const QVariantMap& details )
{
	FeatureMessage msg( m_flagFeature.uid(), ScoreUpdate );
	msg.addArgument( QStringLiteral( "total" ), total );
	msg.addArgument( QStringLiteral( "studentId" ), details.value( QStringLiteral( "studentId" ) ) );
	// sendFeatureMessageToMaster( msg );   // TODO(verify) as above
}

void ProctorFeaturePlugin::onProctorSession( const QString& state, const QString& studentId )
{
	FeatureMessage msg( m_flagFeature.uid(), SessionUpdate );
	msg.addArgument( QStringLiteral( "state" ), state );
	msg.addArgument( QStringLiteral( "studentId" ), studentId );
	// sendFeatureMessageToMaster( msg );   // TODO(verify) as above
}

// ── Master side: receive student updates, paint the thumbnail ─────────────────

bool ProctorFeaturePlugin::handleFeatureMessage( ComputerControlInterface::Pointer computerControlInterface,
                                                 const FeatureMessage& message )
{
	if( message.featureUid() != m_flagFeature.uid() )
	{
		return false;
	}

	switch( message.command() )
	{
	case ViolationUpdate:
	{
		// TODO(verify): argument(key) is the common getter; confirm name.
		const auto severity = message.argument( QStringLiteral( "severity" ) ).toString();
		const auto label    = message.argument( QStringLiteral( "label" ) ).toString();

		// TODO(verify): the actual Master thumbnail-decoration API. Options seen
		// across versions: attaching an overlay via the ComputerControlInterface
		// user data, or emitting through the master model. For a first cut, set
		// a user-visible property the Master's computer view can render:
		computerControlInterface->setUserLoginName(
			QStringLiteral( "[%1] %2" ).arg( severity.toUpper(), label ) );
		// A proper build should instead push a colored badge; see README.
		return true;
	}
	case ScoreUpdate:
	{
		const int total = message.argument( QStringLiteral( "total" ) ).toInt();
		Q_UNUSED( total )
		// TODO(verify): render the score next to the thumbnail.
		return true;
	}
	case SessionUpdate:
		return true;
	default:
		return false;
	}
}

// ── Student (Service) side: receive teacher commands, forward to the app ──────

bool ProctorFeaturePlugin::handleFeatureMessage( VeyonServerInterface& server,
                                                 const MessageContext& messageContext,
                                                 const FeatureMessage& message )
{
	Q_UNUSED( server )
	Q_UNUSED( messageContext )

	// Make sure the hub client is alive on the student PC.
	initServiceSide();

	if( message.featureUid() == m_commandFeature.uid() &&
	    message.command() == SupervisorAction )
	{
		const auto action  = message.argument( QStringLiteral( "action" ) ).toString();
		const auto text    = message.argument( QStringLiteral( "message" ) ).toString();
		if( m_bridge )
		{
			m_bridge->sendCommand( action, text );   // -> hub -> Electron app
		}
		return true;
	}
	return false;
}

bool ProctorFeaturePlugin::handleFeatureMessage( VeyonWorkerInterface& worker,
                                                 const FeatureMessage& message )
{
	Q_UNUSED( worker )
	Q_UNUSED( message )
	// Worker-side handling not needed for this feature.
	return false;
}

// ── Master side: build + send a command down to selected students ─────────────

void ProctorFeaturePlugin::sendCommandToStudent( const ComputerControlInterfaceList& targets,
                                                 const QString& action,
                                                 const QString& message )
{
	FeatureMessage msg( m_commandFeature.uid(), SupervisorAction );
	msg.addArgument( QStringLiteral( "action" ), action );
	msg.addArgument( QStringLiteral( "message" ), message );

	for( const auto& controlInterface : targets )
	{
		// TODO(verify): sendFeatureMessage signature. Common form:
		//   controlInterface->sendFeatureMessage( msg );
		controlInterface->sendFeatureMessage( msg );
	}
}
