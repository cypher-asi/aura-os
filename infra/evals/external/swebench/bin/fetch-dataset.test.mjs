import assert from "node:assert/strict";
import test from "node:test";

import { selectStratifiedRows } from "./fetch-dataset.mjs";

test("selectStratifiedRows round-robins rows by repository", () => {
  const rows = [
    { instance_id: "astropy__astropy-1", repo: "astropy/astropy" },
    { instance_id: "astropy__astropy-2", repo: "astropy/astropy" },
    { instance_id: "django__django-1", repo: "django/django" },
    { instance_id: "django__django-2", repo: "django/django" },
    { instance_id: "sympy__sympy-1", repo: "sympy/sympy" },
  ];

  const selected = selectStratifiedRows(rows, 4);

  assert.deepEqual(
    selected.map((row) => row.instance_id),
    [
      "astropy__astropy-1",
      "django__django-1",
      "sympy__sympy-1",
      "astropy__astropy-2",
    ],
  );
});

test("selectStratifiedRows stops when rows are exhausted", () => {
  const rows = [
    { instance_id: "a__a-1", repo: "a/a" },
    { instance_id: "b__b-1", repo: "b/b" },
  ];

  assert.equal(selectStratifiedRows(rows, 5).length, 2);
});
