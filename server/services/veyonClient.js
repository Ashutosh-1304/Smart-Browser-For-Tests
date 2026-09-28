/**
 * VeyonClient - Service to interact with the Veyon WebAPI.
 * 
 * Veyon (Virtual Eye On Networks) exposes a REST WebAPI (default port 11080)
 * for endpoint orchestration, feature control (e.g. ScreenLock), and session queries.
 *
 * Security:
 * - Credentials and tokens are NEVER exposed to the frontend/client.
 * - Host, port, and connection timeouts are configurable via environment variables.
 * - Graceful degradation: Connection errors are caught and returned safely without crashing.
 */

export class VeyonClient {
  constructor(config = {}) {
    this.host = config.host || process.env.VEYON_HOST || '127.0.0.1';
    this.port = parseInt(config.port || process.env.VEYON_PORT || '11080', 10);
    this.protocol = config.protocol || process.env.VEYON_PROTOCOL || 'http';
    this.timeoutMs = parseInt(config.timeoutMs || process.env.VEYON_TIMEOUT_MS || '3000', 10);
  }

  /**
   * Get the base URL for the Veyon WebAPI.
   * @returns {string} e.g. "http://127.0.0.1:11080"
   */
  getBaseUrl() {
    return `${this.protocol}://${this.host}:${this.port}`;
  }

  /**
   * Check whether the configured Veyon WebAPI service is reachable.
   * Probes /api/v1/session or /api/v1/authentication endpoint.
   * 
   * A response with HTTP 200, 401, or 403 indicates that the WebAPI server is running
   * and listening (authentication status differs from service reachability).
   * Network errors (ECONNREFUSED, ETIMEDOUT) mean the service is offline or unreachable.
   *
   * @returns {Promise<{ available: boolean, service: string, webapi: string, statusCode?: number, error?: string }>}
   */
  async checkHealth() {
    const url = `${this.getBaseUrl()}/api/v1/session`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // If the Veyon WebAPI responds (even with 401 Unauthorized / 403 Forbidden),
      // the daemon is reachable and responding.
      const isReachable = response.status < 500;

      return {
        available: isReachable,
        service: 'veyon',
        webapi: isReachable ? 'reachable' : 'error',
        statusCode: response.status,
        endpoint: `${this.host}:${this.port}`,
      };
    } catch (err) {
      clearTimeout(timeout);

      const isAborted = err.name === 'AbortError';
      const errorMessage = isAborted
        ? `Connection timed out after ${this.timeoutMs}ms`
        : (err.message || 'Connection refused or host unreachable');

      return {
        available: false,
        service: 'veyon',
        webapi: 'unreachable',
        error: errorMessage,
        endpoint: `${this.host}:${this.port}`,
      };
    }
  }

  /**
   * Placeholder/Stub for authenticated session initialization.
   * Official Veyon WebAPI endpoint: POST /api/v1/authentication/<host>
   *
   * @param {string} targetHost
   * @param {Object} credentials
   * @returns {Promise<{ success: boolean, connectionUid?: string, error?: string }>}
   */
  async authenticate(targetHost = 'localhost', credentials = {}) {
    // Kept strictly on the backend. Never exposed to renderer.
    return {
      success: false,
      error: 'Veyon authentication requires configured key files or credentials on a live Veyon node.',
    };
  }
}

export default new VeyonClient();
