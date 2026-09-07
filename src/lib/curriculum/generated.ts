// GENERATED FILE. Produced by scripts/build-static-curriculum.mjs from seed/*.json.
// Do not hand-edit — run `node scripts/build-static-curriculum.mjs` to regenerate.
// `node scripts/build-static-curriculum.mjs --check` fails the build if this file is stale.

import type { Clo, Course, CourseCode } from '../contracts'

export const BUILD_ID: string = "d2aea435cb8333690e3ffed48b5f94bc333acd76"

export const COURSES: readonly Course[] = [
  {
    "cloIds": [
      "INFS1101-1",
      "INFS1101-2",
      "INFS1101-3",
      "INFS1101-4"
    ],
    "code": "INFS1101",
    "language": "python",
    "level": 1,
    "prerequisites": [],
    "runtime": "browser",
    "slug": "intro-computing",
    "status": "live",
    "title": "Intro to Computing & Problem Solving",
    "topics": [
      "problem-solving",
      "flowcharts",
      "variables",
      "selection",
      "iteration",
      "strings",
      "lists",
      "functions",
      "errors"
    ]
  },
  {
    "cloIds": [
      "INFS1201-1",
      "INFS1201-2",
      "INFS1201-3",
      "INFS1201-4"
    ],
    "code": "INFS1201",
    "language": "python",
    "level": 1,
    "prerequisites": [
      "INFS1101"
    ],
    "runtime": "browser",
    "slug": "computer-programming",
    "status": "live",
    "title": "Computer Programming",
    "topics": [
      "lists",
      "aliasing",
      "tuples",
      "dictionaries",
      "sets",
      "searching",
      "sorting",
      "functions",
      "csv",
      "files"
    ]
  },
  {
    "cloIds": [
      "DSAI2201-1",
      "DSAI2201-2",
      "DSAI2201-3",
      "DSAI2201-4",
      "DSAI2201-5"
    ],
    "code": "DSAI2201",
    "language": "python",
    "level": 2,
    "packages": [
      "numpy",
      "pandas",
      "matplotlib",
      "scikit-learn"
    ],
    "prerequisites": [
      "INFS1201"
    ],
    "runtime": "browser",
    "slug": "data-science-ai",
    "status": "live",
    "title": "Intro to Data Science & AI",
    "topics": [
      "descriptive-stats",
      "probability",
      "bayes",
      "numpy",
      "pandas",
      "cleaning",
      "feature-engineering",
      "visualization",
      "ml-fundamentals",
      "regression",
      "classification",
      "evaluation",
      "clustering"
    ]
  },
  {
    "cloIds": [
      "INFS2101-1",
      "INFS2101-2",
      "INFS2101-3",
      "INFS2101-4"
    ],
    "code": "INFS2101",
    "language": "web",
    "level": 2,
    "prerequisites": [
      "INFS1201"
    ],
    "runtime": "browser",
    "slug": "web-technologies-1",
    "status": "live",
    "title": "Web Technologies I",
    "topics": [
      "html",
      "accessibility",
      "css",
      "flexbox",
      "grid",
      "tables",
      "responsive",
      "forms",
      "javascript",
      "events",
      "validation"
    ]
  },
  {
    "cloIds": [
      "INFS2201-1",
      "INFS2201-2",
      "INFS2201-3",
      "INFS2201-4",
      "INFS2201-5"
    ],
    "code": "INFS2201",
    "language": "sql",
    "level": 2,
    "prerequisites": [
      "INFS1201"
    ],
    "runtime": "browser",
    "secondaryLanguage": "mongo",
    "slug": "database-systems",
    "status": "live",
    "title": "Database Management Systems",
    "topics": [
      "relational-model",
      "er-modeling",
      "normalization",
      "sql-ddl",
      "sql-dml",
      "joins",
      "aggregation",
      "subqueries",
      "nosql",
      "mongodb"
    ]
  },
  {
    "cloIds": [
      "INFS3102-1",
      "INFS3102-2",
      "INFS3102-3",
      "INFS3102-4"
    ],
    "code": "INFS3102",
    "language": "java",
    "level": 3,
    "prerequisites": [
      "INFS1201"
    ],
    "runtime": "browser",
    "slug": "object-oriented-programming",
    "status": "live",
    "title": "Object Oriented Programming",
    "topics": [
      "paradigms",
      "java-syntax",
      "classes-objects",
      "encapsulation",
      "static",
      "inheritance",
      "polymorphism",
      "interfaces",
      "associations",
      "collections",
      "exceptions",
      "streams",
      "uml",
      "design-patterns"
    ]
  }
]

export const CLOS: readonly Clo[] = [
  {
    "assessableInCode": true,
    "course": "DSAI2201",
    "id": "DSAI2201-1",
    "ordinal": 1,
    "outcome": "Summarise a dataset with descriptive statistics and exploratory analysis in pandas: central tendency, dispersion, distributions and data types.",
    "patterns": [
      "data-pipeline",
      "aggregate",
      "predict-output"
    ],
    "prerequisites": [],
    "topics": [
      "descriptive-stats",
      "numpy",
      "pandas"
    ]
  },
  {
    "assessableInCode": true,
    "course": "DSAI2201",
    "id": "DSAI2201-2",
    "ordinal": 2,
    "outcome": "Measure and visualise relationships between features using correlation, grouping and univariate or bivariate plots.",
    "patterns": [
      "data-pipeline",
      "aggregate",
      "plot-spec"
    ],
    "prerequisites": [
      "DSAI2201-1"
    ],
    "topics": [
      "visualization",
      "pandas"
    ]
  },
  {
    "assessableInCode": true,
    "course": "DSAI2201",
    "id": "DSAI2201-3",
    "ordinal": 3,
    "outcome": "Clean a real dataset (missing values, outliers, wrong types, duplicates) and engineer new features from existing columns.",
    "patterns": [
      "data-pipeline",
      "guard",
      "transform",
      "boundary"
    ],
    "prerequisites": [
      "DSAI2201-1"
    ],
    "topics": [
      "cleaning",
      "feature-engineering"
    ]
  },
  {
    "assessableInCode": false,
    "course": "DSAI2201",
    "id": "DSAI2201-4",
    "ordinal": 4,
    "outcome": "Explain supervised, unsupervised, semi-supervised and reinforcement learning, and decide which applies to a given problem.",
    "patterns": [
      "spec-to-steps",
      "predict-output",
      "spot-the-bug"
    ],
    "prerequisites": [
      "DSAI2201-2"
    ],
    "topics": [
      "ml-fundamentals"
    ]
  },
  {
    "assessableInCode": true,
    "course": "DSAI2201",
    "id": "DSAI2201-5",
    "ordinal": 5,
    "outcome": "Train and evaluate simple regression and classification models with scikit-learn, splitting data properly and reading the right metric.",
    "patterns": [
      "model-fit-eval",
      "data-pipeline",
      "boundary"
    ],
    "prerequisites": [
      "DSAI2201-3",
      "DSAI2201-4"
    ],
    "topics": [
      "regression",
      "classification",
      "evaluation",
      "clustering"
    ]
  },
  {
    "assessableInCode": false,
    "course": "INFS1101",
    "id": "INFS1101-1",
    "ordinal": 1,
    "outcome": "Explain how a program solves a problem: identify inputs, processing, and outputs, and argue why the algorithm comes before the code.",
    "patterns": [
      "trace",
      "predict-output",
      "spec-to-steps"
    ],
    "prerequisites": [],
    "topics": [
      "problem-solving",
      "flowcharts"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1101",
    "id": "INFS1101-2",
    "ordinal": 2,
    "outcome": "Design an algorithm as pseudocode or a flowchart for a stated problem, then implement it faithfully.",
    "patterns": [
      "spec-to-steps",
      "accumulate",
      "guard"
    ],
    "prerequisites": [
      "INFS1101-1"
    ],
    "topics": [
      "flowcharts",
      "variables",
      "selection"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1101",
    "id": "INFS1101-3",
    "ordinal": 3,
    "outcome": "Control program flow correctly with sequence, selection (if / elif / else) and repetition (for / while), including nested and early-exit forms.",
    "patterns": [
      "guard",
      "accumulate",
      "filter",
      "nested-loop",
      "early-return",
      "boundary",
      "state-machine"
    ],
    "prerequisites": [
      "INFS1101-2"
    ],
    "topics": [
      "selection",
      "iteration"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1101",
    "id": "INFS1101-4",
    "ordinal": 4,
    "outcome": "Write complete Python programs that combine variables, strings, lists and functions to solve a small real problem, and read the errors Python raises.",
    "patterns": [
      "transform",
      "string-parse",
      "search",
      "composition",
      "boundary",
      "index-math"
    ],
    "prerequisites": [
      "INFS1101-3"
    ],
    "topics": [
      "strings",
      "lists",
      "functions",
      "errors"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1201",
    "draft": true,
    "id": "INFS1201-1",
    "ordinal": 1,
    "outcome": "Manipulate lists, tuples, sets and dictionaries, and explain the difference between a copy and an alias, including side effects through function parameters.",
    "patterns": [
      "transform",
      "dict-lookup",
      "set-ops",
      "aliasing",
      "predict-output"
    ],
    "prerequisites": [
      "INFS1101-4"
    ],
    "topics": [
      "lists",
      "aliasing",
      "tuples",
      "dictionaries",
      "sets"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1201",
    "draft": true,
    "id": "INFS1201-2",
    "ordinal": 2,
    "outcome": "Implement linear search, binary search and bubble sort by hand, then choose correctly between them and the built-in membership, index and sort-with-key tools.",
    "patterns": [
      "search",
      "nested-loop",
      "index-math",
      "early-return",
      "boundary",
      "sort-key"
    ],
    "prerequisites": [
      "INFS1201-1"
    ],
    "topics": [
      "searching",
      "sorting"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1201",
    "draft": true,
    "id": "INFS1201-3",
    "ordinal": 3,
    "outcome": "Decompose a program into functions that return multiple values as tuples and process collections of records (lists of tuples or dictionaries).",
    "patterns": [
      "composition",
      "aggregate",
      "filter",
      "transform",
      "dict-lookup"
    ],
    "prerequisites": [
      "INFS1201-1"
    ],
    "topics": [
      "functions",
      "tuples",
      "dictionaries"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS1201",
    "draft": true,
    "id": "INFS1201-4",
    "ordinal": 4,
    "outcome": "Read and write structured data with the csv module and plain files, handling headers, quoting and missing values without crashing.",
    "patterns": [
      "string-parse",
      "aggregate",
      "guard",
      "data-pipeline"
    ],
    "prerequisites": [
      "INFS1201-3"
    ],
    "topics": [
      "csv",
      "files"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2101",
    "id": "INFS2101-1",
    "ordinal": 1,
    "outcome": "Explain how HTML structures a page, how the browser renders it, and the basic accessibility rules every page must meet (semantics, alt text, labels, contrast).",
    "patterns": [
      "spot-the-bug",
      "predict-output",
      "spec-to-steps"
    ],
    "prerequisites": [],
    "topics": [
      "html",
      "accessibility"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2101",
    "id": "INFS2101-2",
    "ordinal": 2,
    "outcome": "Style pages with CSS, build layouts with flexbox and grid, and make them responsive across screen sizes.",
    "patterns": [
      "css-layout",
      "responsive-rule",
      "spot-the-bug"
    ],
    "prerequisites": [
      "INFS2101-1"
    ],
    "topics": [
      "css",
      "flexbox",
      "grid",
      "tables",
      "responsive"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2101",
    "id": "INFS2101-3",
    "ordinal": 3,
    "outcome": "Write JavaScript that handles DOM events and validates form input before submission, showing useful errors to the user.",
    "patterns": [
      "dom-event",
      "guard",
      "string-parse",
      "state-machine"
    ],
    "prerequisites": [
      "INFS2101-2"
    ],
    "topics": [
      "forms",
      "javascript",
      "events",
      "validation"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2101",
    "id": "INFS2101-4",
    "ordinal": 4,
    "outcome": "Build a complete interactive, responsive page that combines semantic HTML, CSS layout and JavaScript behaviour.",
    "patterns": [
      "composition",
      "dom-event",
      "css-layout",
      "state-machine"
    ],
    "prerequisites": [
      "INFS2101-3"
    ],
    "topics": [
      "html",
      "css",
      "javascript",
      "responsive"
    ]
  },
  {
    "assessableInCode": false,
    "course": "INFS2201",
    "id": "INFS2201-1",
    "ordinal": 1,
    "outcome": "Explain what a database management system does, the relational model, primary and foreign keys, and why databases beat flat files.",
    "patterns": [
      "predict-output",
      "spot-the-bug",
      "spec-to-steps"
    ],
    "prerequisites": [],
    "topics": [
      "relational-model"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2201",
    "id": "INFS2201-2",
    "ordinal": 2,
    "outcome": "Model a domain as an entity-relationship diagram and translate it into relational tables with correct keys and cardinalities.",
    "patterns": [
      "schema-design",
      "sql-ddl",
      "spot-the-bug"
    ],
    "prerequisites": [
      "INFS2201-1"
    ],
    "topics": [
      "er-modeling",
      "sql-ddl"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2201",
    "id": "INFS2201-3",
    "ordinal": 3,
    "outcome": "Normalize tables to first, second and third normal form and name the anomaly each step removes.",
    "patterns": [
      "schema-design",
      "spot-the-bug",
      "spec-to-steps"
    ],
    "prerequisites": [
      "INFS2201-2"
    ],
    "topics": [
      "normalization"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2201",
    "id": "INFS2201-4",
    "ordinal": 4,
    "outcome": "Write SQL to create tables, insert and update data, and query with joins, aggregates, grouping, ordering and subqueries.",
    "patterns": [
      "sql-select",
      "sql-join",
      "sql-aggregate",
      "sql-subquery",
      "sql-dml",
      "boundary"
    ],
    "prerequisites": [
      "INFS2201-2"
    ],
    "topics": [
      "sql-ddl",
      "sql-dml",
      "joins",
      "aggregation",
      "subqueries"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS2201",
    "id": "INFS2201-5",
    "ordinal": 5,
    "outcome": "Design document collections for a non-relational database and write MongoDB-style find, update and aggregate queries.",
    "patterns": [
      "mongo-find",
      "mongo-update",
      "mongo-aggregate",
      "schema-design"
    ],
    "prerequisites": [
      "INFS2201-4"
    ],
    "topics": [
      "nosql",
      "mongodb"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS3102",
    "id": "INFS3102-1",
    "ordinal": 1,
    "outcome": "Explain the difference between procedural and object-oriented code, and rewrite a small procedural Java program as classes.",
    "patterns": [
      "refactor-to-class",
      "predict-output",
      "spot-the-bug"
    ],
    "prerequisites": [],
    "topics": [
      "paradigms",
      "java-syntax",
      "classes-objects"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS3102",
    "id": "INFS3102-2",
    "ordinal": 2,
    "outcome": "Design a class structure with UML (classes, attributes, associations, inheritance) before writing code, and implement it faithfully.",
    "patterns": [
      "schema-design",
      "composition",
      "inheritance-dispatch",
      "spec-to-steps"
    ],
    "prerequisites": [
      "INFS3102-1"
    ],
    "topics": [
      "uml",
      "associations",
      "inheritance"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS3102",
    "id": "INFS3102-3",
    "ordinal": 3,
    "outcome": "Write Java classes that use encapsulation, static members, inheritance, interfaces, polymorphism, exception handling and the collections framework correctly.",
    "patterns": [
      "inheritance-dispatch",
      "interface-contract",
      "guard",
      "aggregate",
      "transform",
      "state-machine"
    ],
    "prerequisites": [
      "INFS3102-2"
    ],
    "topics": [
      "encapsulation",
      "static",
      "inheritance",
      "polymorphism",
      "interfaces",
      "collections",
      "exceptions",
      "streams"
    ]
  },
  {
    "assessableInCode": true,
    "course": "INFS3102",
    "id": "INFS3102-4",
    "ordinal": 4,
    "outcome": "Apply recognised design patterns (Strategy, Observer, Factory, Singleton, Decorator) to make code reusable, and justify the choice.",
    "patterns": [
      "interface-contract",
      "composition",
      "refactor-to-pattern",
      "inheritance-dispatch"
    ],
    "prerequisites": [
      "INFS3102-3"
    ],
    "topics": [
      "design-patterns"
    ]
  }
]

export const PATTERNS: readonly { id: string; name: string; description: string; family: string }[] = [
  {
    "description": "Build a running total, count, product or string across a loop.",
    "family": "control-flow",
    "id": "accumulate",
    "name": "Accumulate"
  },
  {
    "description": "Keep only elements that satisfy a condition.",
    "family": "control-flow",
    "id": "filter",
    "name": "Filter"
  },
  {
    "description": "Produce a new collection by changing every element.",
    "family": "control-flow",
    "id": "transform",
    "name": "Transform"
  },
  {
    "description": "Find the position or existence of a target; linear or binary.",
    "family": "control-flow",
    "id": "search",
    "name": "Search"
  },
  {
    "description": "Loop inside a loop: grids, pairs, comparisons.",
    "family": "control-flow",
    "id": "nested-loop",
    "name": "Nested loop"
  },
  {
    "description": "Exit as soon as an answer is known; break and return inside loops.",
    "family": "control-flow",
    "id": "early-return",
    "name": "Early return"
  },
  {
    "description": "Empty input, single element, off-by-one, first and last, zero and negative.",
    "family": "control-flow",
    "id": "boundary",
    "name": "Boundary"
  },
  {
    "description": "Validate input and reject bad cases before the main logic.",
    "family": "control-flow",
    "id": "guard",
    "name": "Guard"
  },
  {
    "description": "Behaviour depends on a mode that changes as input is processed.",
    "family": "control-flow",
    "id": "state-machine",
    "name": "State machine"
  },
  {
    "description": "Compute positions: modulo, midpoints, reversed indices, two pointers.",
    "family": "control-flow",
    "id": "index-math",
    "name": "Index math"
  },
  {
    "description": "A function that calls itself with a smaller problem.",
    "family": "control-flow",
    "id": "recursion",
    "name": "Recursion"
  },
  {
    "description": "Split, slice, scan and rebuild text.",
    "family": "data",
    "id": "string-parse",
    "name": "String parse"
  },
  {
    "description": "Count, group or map with a dictionary.",
    "family": "data",
    "id": "dict-lookup",
    "name": "Dictionary lookup"
  },
  {
    "description": "Union, intersection, difference, dedupe.",
    "family": "data",
    "id": "set-ops",
    "name": "Set operations"
  },
  {
    "description": "Copy vs reference; side effects through shared objects.",
    "family": "data",
    "id": "aliasing",
    "name": "Aliasing"
  },
  {
    "description": "Order records by a chosen field using a helper.",
    "family": "data",
    "id": "sort-key",
    "name": "Sort with key"
  },
  {
    "description": "Summarise records: min, max, mean, group totals.",
    "family": "data",
    "id": "aggregate",
    "name": "Aggregate"
  },
  {
    "description": "Small functions or classes combined into a larger behaviour.",
    "family": "structure",
    "id": "composition",
    "name": "Composition"
  },
  {
    "description": "Turn a plain-language requirement into ordered steps or pseudocode before coding.",
    "family": "structure",
    "id": "spec-to-steps",
    "name": "Spec to steps"
  },
  {
    "description": "Follow variables by hand through a given program.",
    "family": "reading",
    "id": "trace",
    "name": "Trace"
  },
  {
    "description": "State what a snippet prints without running it.",
    "family": "reading",
    "id": "predict-output",
    "name": "Predict output"
  },
  {
    "description": "Find the one line that breaks the program.",
    "family": "reading",
    "id": "spot-the-bug",
    "name": "Spot the bug"
  },
  {
    "description": "Turn procedural code into a class with methods.",
    "family": "oop",
    "id": "refactor-to-class",
    "name": "Refactor to class"
  },
  {
    "description": "Base and derived classes, overriding, polymorphic calls.",
    "family": "oop",
    "id": "inheritance-dispatch",
    "name": "Inheritance dispatch"
  },
  {
    "description": "Program to an interface; multiple implementations.",
    "family": "oop",
    "id": "interface-contract",
    "name": "Interface contract"
  },
  {
    "description": "Apply a named design pattern to remove duplication or coupling.",
    "family": "oop",
    "id": "refactor-to-pattern",
    "name": "Refactor to pattern"
  },
  {
    "description": "Design tables, documents or classes with correct keys and relationships.",
    "family": "data-modeling",
    "id": "schema-design",
    "name": "Schema design"
  },
  {
    "description": "CREATE, ALTER, constraints.",
    "family": "sql",
    "id": "sql-ddl",
    "name": "SQL DDL"
  },
  {
    "description": "INSERT, UPDATE, DELETE.",
    "family": "sql",
    "id": "sql-dml",
    "name": "SQL DML"
  },
  {
    "description": "SELECT with WHERE, ORDER BY, LIMIT.",
    "family": "sql",
    "id": "sql-select",
    "name": "SQL select"
  },
  {
    "description": "Inner, left and multi-table joins.",
    "family": "sql",
    "id": "sql-join",
    "name": "SQL join"
  },
  {
    "description": "GROUP BY, HAVING, aggregate functions.",
    "family": "sql",
    "id": "sql-aggregate",
    "name": "SQL aggregate"
  },
  {
    "description": "Nested and correlated subqueries.",
    "family": "sql",
    "id": "sql-subquery",
    "name": "SQL subquery"
  },
  {
    "description": "Query documents with operators and projections.",
    "family": "nosql",
    "id": "mongo-find",
    "name": "Mongo find"
  },
  {
    "description": "Update operators, upserts, array updates.",
    "family": "nosql",
    "id": "mongo-update",
    "name": "Mongo update"
  },
  {
    "description": "Aggregation pipelines: match, group, sort, project.",
    "family": "nosql",
    "id": "mongo-aggregate",
    "name": "Mongo aggregate"
  },
  {
    "description": "Attach handlers, read inputs, update the page.",
    "family": "web",
    "id": "dom-event",
    "name": "DOM event"
  },
  {
    "description": "Flexbox and grid to hit a target layout.",
    "family": "web",
    "id": "css-layout",
    "name": "CSS layout"
  },
  {
    "description": "Media queries and fluid units to adapt to screen size.",
    "family": "web",
    "id": "responsive-rule",
    "name": "Responsive rule"
  },
  {
    "description": "Chain pandas or numpy operations to reach a result.",
    "family": "data-science",
    "id": "data-pipeline",
    "name": "Data pipeline"
  },
  {
    "description": "Choose and configure the right chart for a question.",
    "family": "data-science",
    "id": "plot-spec",
    "name": "Plot spec"
  },
  {
    "description": "Split, fit, predict, score with the right metric.",
    "family": "data-science",
    "id": "model-fit-eval",
    "name": "Model fit and eval"
  }
]

export const COURSE_HASHES: Readonly<Record<CourseCode, string>> = {
  "DSAI2201": "d794ea4f06be80a148b0fb21635ee50c7d1927a6",
  "INFS1101": "1d7e982700d07de616ae037afd89885b730bf221",
  "INFS1201": "17603f172323eecb814a47169d45f916096d3670",
  "INFS2101": "4323c5056d782785d0f8869aa375b4b2fc2b91b3",
  "INFS2201": "4f012fde24482df9804a66cc3f1168e33cd93268",
  "INFS3102": "016cc124eed83550da08042077797167731b9492"
}
