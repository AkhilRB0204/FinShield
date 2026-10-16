import "./Band.css";

/** A full-width section of main content, divided from the next by a hairline. */
export default function Band({ children, as: Tag = "section", ...props }) {
  return (
    <Tag className="band" {...props}>
      {children}
    </Tag>
  );
}
