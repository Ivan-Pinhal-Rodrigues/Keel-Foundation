/** @vitest-environment jsdom */
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from "@/components/ThemeProvider";

afterEach(() => {
  cleanup();
  document.cookie = "keel-theme=; path=/; max-age=0";
  delete document.documentElement.dataset.theme;
});

test("toggle flips data-theme on the document element", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: /theme/i }));
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("a second click switches to system and removes data-theme", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  const button = screen.getByRole("button", { name: /theme/i });
  await userEvent.click(button); // light -> dark
  await userEvent.click(button); // dark -> system
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(document.cookie).not.toContain("keel-theme=");
});

test("a third click returns to light and writes the cookie", async () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  const button = screen.getByRole("button", { name: /theme/i });
  await userEvent.click(button); // light -> dark
  await userEvent.click(button); // dark -> system
  await userEvent.click(button); // system -> light
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  expect(document.cookie).toContain("keel-theme=light");
});

test("an existing keel-theme=dark cookie sets data-theme on mount", () => {
  document.cookie = "keel-theme=dark; path=/";
  render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("useTheme throws when used outside a ThemeProvider", () => {
  const Orphan = () => {
    useTheme();
    return null;
  };
  expect(() => render(<Orphan />)).toThrow(/ThemeProvider/);
});
