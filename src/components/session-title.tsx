type SessionTitleProps = {
  title: string;
};

export function SessionTitle({ title }: SessionTitleProps) {
  return <div className="session-title-heading"><h1>{title}</h1></div>;
}
