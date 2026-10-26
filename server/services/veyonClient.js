
export class VeyonClient {
  constructor(config = {}) {
    this.host = config.host || process.env.VEYON_HOST || '127.0.0.1';
    this.port = parseInt(config.port || process.env.VEYON_PORT || '11080', 10);
    this.protocol = config.protocol || process.env.VEYON_PROTOCOL || 'http';
    this.timeoutMs = parseInt(config.timeoutMs || process.env.VEYON_TIMEOUT_MS || '3000', 10);
  }

  getBaseUrl() {
    return `${this.protocol}://${this.host}:${this.port}`;
  }

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

  async authenticate(targetHost = 'localhost', credentials = {}) {
    return {
      success: false,
      error: 'Veyon authentication requires configured key files or credentials on a live Veyon node.',
    };
  }
}

export default new VeyonClient();
