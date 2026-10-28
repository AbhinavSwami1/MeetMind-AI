import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// Shows the real error instead of a blank white page.
class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <main style={{ padding: 32, maxWidth: 640 }}>
        <h2>Something went wrong</h2>
        <pre style={{ whiteSpace: "pre-wrap", color: "#d6304a" }}>{String(this.state.err.stack || this.state.err)}</pre>
        <button onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}
createRoot(document.getElementById("root")).render(<Boundary><App /></Boundary>);
