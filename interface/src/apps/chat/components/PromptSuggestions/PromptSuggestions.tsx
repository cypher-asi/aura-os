import styles from "./PromptSuggestions.module.css";

const SUGGESTIONS = [
  "What can you help me with?",
  "Write me a short story",
  "Explain how AI agents work",
  "Help me brainstorm ideas for a project",
];

interface Props {
  onSelect: (prompt: string) => void;
}

export function PromptSuggestions({ onSelect }: Props) {
  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {SUGGESTIONS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className={styles.chip}
            onClick={() => onSelect(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
