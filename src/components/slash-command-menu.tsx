export type SlashCommand = {
  name: "compact" | "copy" | "name" | "reload" | "session";
  description: string;
  acceptsArgument: boolean;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "reload", description: "重新加载扩展、技能、提示词和工具", acceptsArgument: false },
  { name: "compact", description: "压缩上下文，可选附加说明", acceptsArgument: true },
  { name: "copy", description: "复制最后一条助手消息", acceptsArgument: false },
  { name: "name", description: "设置会话显示名称", acceptsArgument: true },
  { name: "session", description: "显示会话消息、Token 和费用统计", acceptsArgument: false },
];

type SlashCommandMenuProps = {
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
};

export function SlashCommandMenu({ commands, activeIndex, onSelect }: SlashCommandMenuProps) {
  return (
    <div id="slash-command-menu" className="slash-command-menu" role="listbox" aria-label="斜杠命令">
      <header><span>斜杠命令 · {commands.length} 个命令</span><kbd>↑↓←→ 选择 · Tab/Enter 确认</kbd></header>
      <p className="slash-command-category">内置</p>
      <div className="slash-command-options">
        {commands.map((command, index) => (
          <button
            className={index === activeIndex ? "selected" : ""}
            id={`slash-command-${index}`}
            key={command.name}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(command)}
          >
            <strong>/{command.name}</strong>
            <span>{command.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
