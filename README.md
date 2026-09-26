# ship-label-parser

A parser for a plain-text shipping label format. No dependencies, no build
step required to read the source — just a tokenizer and a hand-written
parser that turns a text document into a `from` address, a `to` address,
and package details.

## Why

Shipping labels usually get typed into a form or dropped into a batch
file by hand, and the input is wrong more often than not: a postal code
missing a digit, a weight with no unit, a field name misspelled. Most
parsers for this kind of thing tell you *that* something is wrong but not
*where* — you get "invalid input" and have to scan the whole document
yourself. This one always points at an exact line and column, the way a
compiler does.

## The format

```
from:
  name: Jane Doe
  street: 123 Main St
  city: Springfield
  state: IL
  postal: 62704
  country: US

to:
  name: John Smith
  street: 500 Market St
  city: Chicago
  state: IL
  postal: 60601
  country: US

package:
  weight: 2.5 lb
  length: 10 in
  width: 8 in
  height: 4 in
  service: priority
```

Three block types (`from`, `to`, `package`), each with indented
`key: value` fields. `from` and `to` may each appear once; `package` may
repeat — one block per parcel — and at least one is required. Lines
starting with `#` and blank lines are ignored anywhere.

## Usage

```ts
import { parseLabel, LabelSyntaxError } from 'ship-label-parser'

const source = `
from:
  name: Jane Doe
  street: 123 Main St
  city: Springfield
  state: IL
  postal: 62704
  country: US

to:
  name: John Smith
  street: 500 Market St
  city: Chicago
  state: IL
  postal: 60601
  country: US

package:
  weight: 2.5 lbs
  length: 10 in
  width: 8 in
  height: 4 in
  service: priority
`

try {
  const label = parseLabel(source, 'orders/1042.slbl')
  console.log(label.to.city, label.packages[0].weight)
} catch (err) {
  if (err instanceof LabelSyntaxError) {
    console.error(err.toString())
  } else {
    throw err
  }
}
```

That example has a typo (`lbs` instead of `lb`), so it prints:

```
error: unknown unit "lbs", expected one of "lb", "kg"
  --> orders/1042.slbl:15:11
   |
15 |   weight: 2.5 lbs
   |           ^^^
```

## What's validated right now

- block and field names, with a list of what was expected when one is wrong
- required fields on both addresses and the package block
- US and Canadian postal code formats (other countries are accepted as-is)
- measurement fields (`weight`, `length`, `width`, `height`) as a number
  plus a unit (`lb`/`kg`, `in`/`cm`)
- `service` against a fixed set of levels (`ground`, `priority`, `express`)

## Status

Early skeleton. A document holds one `from`/`to` pair but can carry
multiple `package` blocks (`label.packages` is always an array, even for
a single parcel); see the roadmap for what's planned next.
