/*
 * ProctorFeaturePlugin.h - Veyon plugin that bridges the Smart Browser
 * proctoring app to the Veyon Master console.
 *
 * ONE plugin binary loads on BOTH ends (this is how every Veyon feature works):
 *   - On the STUDENT PC  it runs inside the Veyon *Service/Worker*. There it
 *     connects to the local proctoring hub (ws://localhost:3001/proctor) as the
 *     "agent" role, receives violation/score messages, and relays them to the
 *     Master using Veyon's own FeatureMessage transport.
 *   - On the TEACHER PC it runs inside the Veyon *Master*. There it receives
 *     those messages and raises a flag on the student's thumbnail, and sends
 *     teacher actions (lock/warn/end) back down to the student.
 *
 * The role is decided at runtime from the Feature flags + the component the
 * plugin is loaded in (checked via the passed interfaces), NOT by shipping two
 * binaries.
 *
 * Verified against Veyon source (core/include):
 *   - PluginInterface            (uid/version/name/description/vendor/copyright)
 *   - FeatureProviderInterface   (featureList(), controlFeature(), message hooks)
 *   - Feature / Feature::Uid / FeatureProviderInterface::Operation
 *
 * TODO(verify): FeatureMessage argument get/set API is version-sensitive. The
 * exact method names used below (addArgument/argument) are marked where used;
 * cross-check against your installed Veyon's core/include/FeatureMessage.h.
 */
#pragma once

#include <QObject>
#include "PluginInterface.h"
#include "FeatureProviderInterface.h"

class ProctorBridgeClient;

class ProctorFeaturePlugin : public QObject,
                             public PluginInterface,
                             public FeatureProviderInterface
{
	Q_OBJECT
	Q_PLUGIN_METADATA( IID "io.veyon.Veyon.Plugins.ProctorFeature" )
	Q_INTERFACES( PluginInterface FeatureProviderInterface )

public:
	explicit ProctorFeaturePlugin( QObject* parent = nullptr );
	~ProctorFeaturePlugin() override;

	// ── PluginInterface ──────────────────────────────────────────────────────
	Plugin::Uid uid() const override
	{
		// Randomly-generated, stable UID for this plugin. Replace if it ever
		// collides with another plugin (uuidgen).
		return QStringLiteral( "a3f1c7e2-6b84-4d19-9f03-2c5e8d7a1b64" );
	}

	QVersionNumber version() const override
	{
		return QVersionNumber( 1, 0 );
	}

	QString name() const override            { return QStringLiteral( "ProctorFeature" ); }
	QString description() const override      { return tr( "Shows Smart Browser proctoring flags on the Master and relays supervisor actions" ); }
	QString vendor() const override           { return QStringLiteral( "Smart Browser" ); }
	QString copyright() const override        { return QStringLiteral( "Smart Browser project" ); }

	// ── FeatureProviderInterface ──────────────────────────────────────────────
	const FeatureList& featureList() const override;

	bool controlFeature( Feature::Uid featureUid,
	                      Operation operation,
	                      const QVariantMap& arguments,
	                      const ComputerControlInterfaceList& computerControlInterfaces ) override;

	// Master receives messages coming up from the student's Service.
	bool handleFeatureMessage( ComputerControlInterface::Pointer computerControlInterface,
	                           const FeatureMessage& message ) override;

	// Service/Worker receives messages (teacher commands) coming down.
	bool handleFeatureMessage( VeyonServerInterface& server,
	                           const MessageContext& messageContext,
	                           const FeatureMessage& message ) override;

	bool handleFeatureMessage( VeyonWorkerInterface& worker,
	                           const FeatureMessage& message ) override;

	bool startFeature( VeyonMasterInterface& master,
	                   const Feature& feature,
	                   const ComputerControlInterfaceList& computerControlInterfaces ) override;

	bool stopFeature( VeyonMasterInterface& master,
	                  const Feature& feature,
	                  const ComputerControlInterfaceList& computerControlInterfaces ) override;

private slots:
	// Fired by the local-hub client (student side only) when the proctoring app
	// reports something. We package it into a FeatureMessage for the Master.
	void onProctorViolation( const QVariantMap& violation );
	void onProctorScore( int total, const QVariantMap& details );
	void onProctorSession( const QString& state, const QString& studentId );

private:
	// Message command ids carried inside a FeatureMessage.
	enum MessageCommand
	{
		ViolationUpdate = 0,   // student -> master
		ScoreUpdate     = 1,   // student -> master
		SessionUpdate   = 2,   // student -> master
		SupervisorAction = 3,  // master  -> student
	};

	void initServiceSide();   // start the localhost-hub client
	void sendCommandToStudent( const ComputerControlInterfaceList& targets,
	                           const QString& action, const QString& message );

	Feature m_flagFeature;     // carries proctoring state onto the thumbnail
	Feature m_commandFeature;  // teacher action trigger (lock/warn/end)
	FeatureList m_features;

	ProctorBridgeClient* m_bridge = nullptr;  // student side only; null on Master
};
