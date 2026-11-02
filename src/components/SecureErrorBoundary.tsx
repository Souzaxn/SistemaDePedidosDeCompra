import { Component, ErrorInfo, ReactNode } from "react";
import tecarLogo from "../imports/image-1.png";

export function SecureErrorScreen() {
  return (
    <div className="secure-error-page">
      <div className="secure-error-card">
        <span className="secure-error-logo">
          <img src={tecarLogo} alt="Grupo Tecar" />
        </span>
        <h1>Não foi possível carregar o sistema.</h1>
        <p>Atualize a página ou tente novamente em instantes.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class SecureErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Application error", error, info);
    }
  }

  render() {
    if (this.state.failed) return <SecureErrorScreen />;
    return this.props.children;
  }
}
