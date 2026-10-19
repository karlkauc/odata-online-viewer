import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../src/components/Icon";

describe("Icon", () => {
  it.each(ICON_NAMES)("renders %s as a decorative svg", (name) => {
    const { container } = render(<Icon name={name} size={20} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg?.childElementCount).toBeGreaterThan(0);
  });
});
