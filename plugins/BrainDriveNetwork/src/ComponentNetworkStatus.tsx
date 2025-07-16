import React from 'react';
import './ComponentNetworkStatus.css';

type Status = 'online' | 'offline' | 'unknown';

interface Target {
  name: string;
  url: string;
}

const targets: Target[] = [
  { name: 'Ollama', url: 'https://www.ollama.com' },
  { name: 'Local Ollama', url: 'http://localhost:11434' },
];

interface ComponentNetworkStatusState {
  statuses: Record<string, Status>;
}

/**
 * NetworkStatus component using class-based approach for remote plugin compatibility
 */
class ComponentNetworkStatus extends React.Component<{}, ComponentNetworkStatusState> {
  constructor(props: {}) {
    super(props);
    this.state = {
      statuses: {
        Ollama: 'unknown',
        'Local Ollama': 'unknown'
      }
    };
  }

  async check(name: string, url: string) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timer);
      this.setState(prevState => ({
        statuses: { ...prevState.statuses, [name]: 'online' }
      }));
    } catch {
      this.setState(prevState => ({
        statuses: { ...prevState.statuses, [name]: 'offline' }
      }));
    }
  }

  componentDidMount() {
    targets.forEach(t => this.check(t.name, t.url));
  }

  render() {
    const { statuses } = this.state;

    return (
      <div className="bd-network-status">
        <h3>Network Status (v1.0.7)</h3>
        <ul>
          {targets.map(t => (
            <li key={t.name} className={`status ${statuses[t.name]}`}>
              <span className="indicator" />
              <span>{t.name}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}

export default ComponentNetworkStatus;
