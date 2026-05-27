import { describe, expect, it } from "vitest";

import { parseUncheckedTodos } from "./YourTodoRow";

describe("parseUncheckedTodos", () => {
  it("returns no items for empty / null content", () => {
    expect(parseUncheckedTodos(null)).toEqual([]);
    expect(parseUncheckedTodos("")).toEqual([]);
  });

  it("extracts unchecked todo lines", () => {
    const md = `# My Todos

## Active
- [ ] Call my mom for Mother's Day
- [ ] Pay rent
- [x] Buy groceries`;
    expect(parseUncheckedTodos(md)).toEqual([
      "Call my mom for Mother's Day",
      "Pay rent"
    ]);
  });

  it("ignores checked items", () => {
    const md = `- [x] Done thing
- [X] Also done
- [ ] Still to do`;
    expect(parseUncheckedTodos(md)).toEqual(["Still to do"]);
  });

  it("strips inline scope tags like #braindrive-plus-one", () => {
    const md = `- [ ] Call my mom for Mother's Day #braindrive-plus-one
- [ ] Pay rent #finance`;
    expect(parseUncheckedTodos(md)).toEqual([
      "Call my mom for Mother's Day",
      "Pay rent"
    ]);
  });

  it("accepts both dash and asterisk bullets", () => {
    const md = `- [ ] First
* [ ] Second`;
    expect(parseUncheckedTodos(md)).toEqual(["First", "Second"]);
  });

  it("tolerates indentation", () => {
    const md = `  - [ ] Indented todo
    * [ ] Deeply indented`;
    expect(parseUncheckedTodos(md)).toEqual([
      "Indented todo",
      "Deeply indented"
    ]);
  });
});
