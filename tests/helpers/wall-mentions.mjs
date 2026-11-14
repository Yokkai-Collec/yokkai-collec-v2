import { createElement } from "react";

// Isolate the enclosing wall in tests that do not exercise mention lookups.
export const wallMentions = {
  WallMentionText: ({ text }) => text,
  WallMentionTextarea: ({ onChange, ...props }) =>
    createElement("textarea", {
      ...props,
      onChange: event => onChange(event.currentTarget.value)
    })
};
