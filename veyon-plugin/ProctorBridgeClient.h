/*
 * ProctorBridgeClient.h - QWebSocket client that connects the Service-side
 * plugin to the Smart Browser proctoring hub on the SAME student PC
 * (ws://localhost:3001/proctor), speaking the exact JSON contract defined in
 * server/proctor/bridge.js.
 *
 * It connects as role "agent":
 *   OUT (to app):   { type:"hello", role:"agent", name:"veyon" }
 *                   { type:"command", action, message, at }
 *   IN  (from app): { type:"welcome"|"peers"|"snapshot" }
 *                   { type:"session",   state, studentId, code, url, at }
 *                   { type:"violation", studentId, violation:{kind,label,message,severity,at} }
 *                   { type:"score",     studentId, total, breakdown, at }
 *
 * Needs Qt WebSockets module (Qt6::WebSockets). Auto-reconnects, because the
 * Veyon Service may well start before the Electron app does.
 */
#pragma once

#include <QObject>
#include <QTimer>
#include <QVariantMap>

QT_BEGIN_NAMESPACE
class QWebSocket;
QT_END_NAMESPACE

class ProctorBridgeClient : public QObject
{
	Q_OBJECT
public:
	explicit ProctorBridgeClient( QObject* parent = nullptr );
	~ProctorBridgeClient() override;

	void start( const QString& url );
	void stop();

	// Master command -> app (lock/unlock/warn/end/acknowledge).
	void sendCommand( const QString& action, const QString& message );

signals:
	void violationReceived( const QVariantMap& violation );   // includes studentId
	void scoreReceived( int total, const QVariantMap& details );
	void sessionChanged( const QString& state, const QString& studentId );
	void connectedChanged( bool connected );

private slots:
	void onConnected();
	void onDisconnected();
	void onTextMessage( const QString& text );
	void tryReconnect();

private:
	void sendJson( const QVariantMap& obj );

	QWebSocket* m_socket = nullptr;
	QTimer m_reconnectTimer;
	QString m_url;
	bool m_running = false;
};
