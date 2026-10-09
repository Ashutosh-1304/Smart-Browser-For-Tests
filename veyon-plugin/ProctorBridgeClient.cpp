/*
 * ProctorBridgeClient.cpp - see header. Pure Qt, no Veyon dependency, so this
 * part can be unit-tested on its own against the Node hub.
 */
#include "ProctorBridgeClient.h"

#include <QWebSocket>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QJsonArray>
#include <QDateTime>

ProctorBridgeClient::ProctorBridgeClient( QObject* parent ) :
	QObject( parent )
{
	m_reconnectTimer.setInterval( 2000 );
	m_reconnectTimer.setSingleShot( true );
	connect( &m_reconnectTimer, &QTimer::timeout, this, &ProctorBridgeClient::tryReconnect );
}

ProctorBridgeClient::~ProctorBridgeClient()
{
	stop();
}

void ProctorBridgeClient::start( const QString& url )
{
	m_url = url;
	m_running = true;

	if( !m_socket )
	{
		m_socket = new QWebSocket( {}, QWebSocketProtocol::VersionLatest, this );
		connect( m_socket, &QWebSocket::connected,    this, &ProctorBridgeClient::onConnected );
		connect( m_socket, &QWebSocket::disconnected, this, &ProctorBridgeClient::onDisconnected );
		connect( m_socket, &QWebSocket::textMessageReceived, this, &ProctorBridgeClient::onTextMessage );
	}
	m_socket->open( QUrl( m_url ) );
}

void ProctorBridgeClient::stop()
{
	m_running = false;
	m_reconnectTimer.stop();
	if( m_socket )
	{
		m_socket->close();
	}
}

void ProctorBridgeClient::onConnected()
{
	emit connectedChanged( true );

	// Announce ourselves as the control agent. The hub then replays a snapshot
	// of the current session/score so we are instantly up to date.
	QVariantMap hello;
	hello.insert( QStringLiteral( "type" ), QStringLiteral( "hello" ) );
	hello.insert( QStringLiteral( "role" ), QStringLiteral( "agent" ) );
	hello.insert( QStringLiteral( "name" ), QStringLiteral( "veyon" ) );
	sendJson( hello );
}

void ProctorBridgeClient::onDisconnected()
{
	emit connectedChanged( false );
	if( m_running )
	{
		m_reconnectTimer.start();
	}
}

void ProctorBridgeClient::tryReconnect()
{
	if( m_running && m_socket )
	{
		m_socket->open( QUrl( m_url ) );
	}
}

void ProctorBridgeClient::onTextMessage( const QString& text )
{
	const auto doc = QJsonDocument::fromJson( text.toUtf8() );
	if( !doc.isObject() )
	{
		return;
	}
	const auto obj = doc.object();
	const auto type = obj.value( QStringLiteral( "type" ) ).toString();

	if( type == QLatin1String( "violation" ) )
	{
		const auto v = obj.value( QStringLiteral( "violation" ) ).toObject();
		QVariantMap out = v.toVariantMap();
		out.insert( QStringLiteral( "studentId" ),
		            obj.value( QStringLiteral( "studentId" ) ).toString() );
		emit violationReceived( out );
	}
	else if( type == QLatin1String( "score" ) )
	{
		QVariantMap details;
		details.insert( QStringLiteral( "studentId" ),
		                obj.value( QStringLiteral( "studentId" ) ).toString() );
		details.insert( QStringLiteral( "breakdown" ),
		                obj.value( QStringLiteral( "breakdown" ) ).toArray().toVariantList() );
		emit scoreReceived( obj.value( QStringLiteral( "total" ) ).toInt(), details );
	}
	else if( type == QLatin1String( "session" ) )
	{
		emit sessionChanged( obj.value( QStringLiteral( "state" ) ).toString(),
		                     obj.value( QStringLiteral( "studentId" ) ).toString() );
	}
	else if( type == QLatin1String( "snapshot" ) )
	{
		// Replay cached state captured before we connected.
		const auto session = obj.value( QStringLiteral( "session" ) ).toObject();
		if( !session.isEmpty() )
		{
			emit sessionChanged( session.value( QStringLiteral( "state" ) ).toString(),
			                     session.value( QStringLiteral( "studentId" ) ).toString() );
		}
		const auto score = obj.value( QStringLiteral( "score" ) ).toObject();
		if( !score.isEmpty() )
		{
			QVariantMap details;
			details.insert( QStringLiteral( "studentId" ),
			                score.value( QStringLiteral( "studentId" ) ).toString() );
			emit scoreReceived( score.value( QStringLiteral( "total" ) ).toInt(), details );
		}
	}
	// "welcome"/"peers"/"error" are informational — ignored here.
}

void ProctorBridgeClient::sendCommand( const QString& action, const QString& message )
{
	QVariantMap cmd;
	cmd.insert( QStringLiteral( "type" ), QStringLiteral( "command" ) );
	cmd.insert( QStringLiteral( "action" ), action );
	cmd.insert( QStringLiteral( "message" ), message );
	cmd.insert( QStringLiteral( "at" ), QDateTime::currentMSecsSinceEpoch() );
	sendJson( cmd );
}

void ProctorBridgeClient::sendJson( const QVariantMap& obj )
{
	if( !m_socket || m_socket->state() != QAbstractSocket::ConnectedState )
	{
		return;
	}
	const auto doc = QJsonDocument( QJsonObject::fromVariantMap( obj ) );
	m_socket->sendTextMessage( QString::fromUtf8( doc.toJson( QJsonDocument::Compact ) ) );
}
