export interface PromptOption {
  key: string;
  label: string;
  value: string;
}

export interface InputReader {
  readLine(prompt?: string): Promise<string>;
  readKey(prompt: string, options: PromptOption[]): Promise<string>;
  close(): Promise<void>;
}
