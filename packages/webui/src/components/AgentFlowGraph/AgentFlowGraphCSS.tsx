/**
 * AgentFlowGraphCSS — Injects CSS styles for React Flow visualization.
 * Using a React component to inject CSS avoids style isolation issues.
 */

export function AgentFlowGraphCSS() {
  return (
    <style>{`
      .react-flow__node {
        cursor: pointer;
        transition: transform 0.15s ease;
      }
      .react-flow__node:hover {
        transform: scale(1.02);
      }
      .react-flow__edge-path {
        transition: stroke-width 0.2s ease, stroke-opacity 0.2s ease;
      }
      /* Animated edges with flowing dashes */
      .animated-edge {
        animation: flowDash 1s linear infinite;
      }
      @keyframes flowDash {
        0% { stroke-dashoffset: 10; }
        100% { stroke-dashoffset: 0; }
      }
      /* Custom controls styling */
      .react-flow__controls {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
      }
      .react-flow__controls-button {
        background: transparent;
        border: none;
        color: hsl(var(--foreground));
        transition: background 0.2s ease;
      }
      .react-flow__controls-button:hover {
        background: hsl(var(--muted));
      }
      .react-flow__controls-button svg {
        fill: currentColor;
      }
      /* MiniMap styling */
      .react-flow__minimap {
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid hsl(var(--border));
      }
      /* Selection styling */
      .react-flow__node.selected {
        z-index: 100;
      }
      /* Edge hover */
      .react-flow__edge:hover .react-flow__edge-path {
        stroke-width: 3;
      }
      /* React Flow attribution hidden */
      .react-flow__attribution {
        display: none;
      }
      /* Background dots styling */
      .react-flow__background {
        background-color: hsl(var(--background));
      }
    `}</style>
  );
}
