import { hello } from "./index";

test("should say hello name", () => {
  expect(hello("name")).toContain("name");
  expect(hello("name")).toContain("Hello");
});
