import { LabelSyntaxError } from './errors'

export interface Address {
  name: string
  street: string
  city: string
  state: string
  postal: string
  country: string
}

export interface PackageInfo {
  weight: { value: number; unit: 'lb' | 'kg' }
  length: { value: number; unit: 'in' | 'cm' }
  width: { value: number; unit: 'in' | 'cm' }
  height: { value: number; unit: 'in' | 'cm' }
  service: 'ground' | 'priority' | 'express'
}

export interface ShippingLabel {
  from: Address
  to: Address
  package: PackageInfo
}

const BLOCK_NAMES = ['from', 'to', 'package'] as const
const ADDRESS_FIELDS = ['name', 'street', 'city', 'state', 'postal', 'country'] as const
const PACKAGE_FIELDS = ['weight', 'length', 'width', 'height', 'service'] as const
const SERVICE_LEVELS = ['ground', 'priority', 'express'] as const

// postal code patterns we can actually vouch for; countries not listed
// here are accepted as-is until someone adds their pattern
const COUNTRY_POSTAL_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/,
}

interface RawLine {
  text: string
  lineNumber: number
  indent: number
  content: string
}

interface FieldValue {
  value: string
  line: RawLine
  valueColumn: number
}

function splitLines(source: string): RawLine[] {
  const rawLines = source.split(/\r\n|\r|\n/)
  const lines: RawLine[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i]
    const content = text.replace(/^[ \t]*/, '')
    if (content.length === 0 || content.startsWith('#')) continue
    lines.push({ text, lineNumber: i + 1, indent: text.length - content.length, content })
  }
  return lines
}

function splitKeyValue(line: RawLine, sourceName: string): { key: string; keyColumn: number; value: string; valueColumn: number } {
  const colonIndex = line.content.indexOf(':')
  if (colonIndex === -1) {
    throw new LabelSyntaxError({
      message: `expected ':' after the field name`,
      line: line.lineNumber,
      column: line.indent + line.content.length + 1,
      lineText: line.text,
      length: 1,
      sourceName,
    })
  }
  const key = line.content.slice(0, colonIndex).trim()
  const afterColon = line.content.slice(colonIndex + 1)
  const value = afterColon.trim()
  const leadingSpaces = afterColon.length - afterColon.trimStart().length
  return {
    key,
    keyColumn: line.indent + 1,
    value,
    valueColumn: line.indent + colonIndex + 1 + leadingSpaces + 1,
  }
}

function readFields(lines: RawLine[], allowed: readonly string[], sourceName: string): Map<string, FieldValue> {
  const values = new Map<string, FieldValue>()
  for (const line of lines) {
    const { key, keyColumn, value, valueColumn } = splitKeyValue(line, sourceName)
    if (!allowed.includes(key)) {
      throw new LabelSyntaxError({
        message: `unknown field "${key}", expected one of ${allowed.map((f) => `"${f}"`).join(', ')}`,
        line: line.lineNumber,
        column: keyColumn,
        lineText: line.text,
        length: key.length,
        sourceName,
      })
    }
    if (values.has(key)) {
      throw new LabelSyntaxError({
        message: `duplicate field "${key}"`,
        line: line.lineNumber,
        column: keyColumn,
        lineText: line.text,
        length: key.length,
        sourceName,
      })
    }
    if (value.length === 0) {
      throw new LabelSyntaxError({
        message: `field "${key}" has no value`,
        line: line.lineNumber,
        column: keyColumn,
        lineText: line.text,
        length: key.length,
        sourceName,
      })
    }
    values.set(key, { value, line, valueColumn })
  }
  return values
}

function requireFields(values: Map<string, FieldValue>, required: readonly string[], fieldLines: RawLine[], blockLabel: string, sourceName: string): void {
  for (const field of required) {
    if (values.has(field)) continue
    const anchor = fieldLines[fieldLines.length - 1]
    throw new LabelSyntaxError({
      message: `${blockLabel} is missing required field "${field}"`,
      line: anchor ? anchor.lineNumber : 1,
      column: 1,
      lineText: anchor ? anchor.text : '',
      length: 1,
      sourceName,
    })
  }
}

function parseAddress(fieldLines: RawLine[], label: string, sourceName: string): Address {
  const values = readFields(fieldLines, ADDRESS_FIELDS, sourceName)
  requireFields(values, ADDRESS_FIELDS, fieldLines, label, sourceName)

  const country = values.get('country')!.value.toUpperCase()
  const postal = values.get('postal')!
  const pattern = COUNTRY_POSTAL_PATTERNS[country]
  if (pattern && !pattern.test(postal.value)) {
    throw new LabelSyntaxError({
      message: `postal code "${postal.value}" is not valid for country "${country}"`,
      line: postal.line.lineNumber,
      column: postal.valueColumn,
      lineText: postal.line.text,
      length: postal.value.length,
      sourceName,
    })
  }

  return {
    name: values.get('name')!.value,
    street: values.get('street')!.value,
    city: values.get('city')!.value,
    state: values.get('state')!.value,
    postal: postal.value,
    country,
  }
}

function parseMeasurement(field: FieldValue, allowedUnits: readonly string[], sourceName: string): { value: number; unit: string } {
  const match = field.value.match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/)
  if (!match) {
    throw new LabelSyntaxError({
      message: `expected a number followed by a unit (e.g. "2.5 lb"), got "${field.value}"`,
      line: field.line.lineNumber,
      column: field.valueColumn,
      lineText: field.line.text,
      length: field.value.length,
      sourceName,
    })
  }
  const [, numberText, unit] = match
  const amount = Number(numberText)
  if (amount <= 0) {
    throw new LabelSyntaxError({
      message: `measurement must be greater than zero, got "${field.value}"`,
      line: field.line.lineNumber,
      column: field.valueColumn,
      lineText: field.line.text,
      length: field.value.length,
      sourceName,
    })
  }
  if (!allowedUnits.includes(unit.toLowerCase())) {
    throw new LabelSyntaxError({
      message: `unknown unit "${unit}", expected one of ${allowedUnits.map((u) => `"${u}"`).join(', ')}`,
      line: field.line.lineNumber,
      column: field.valueColumn + field.value.indexOf(unit),
      lineText: field.line.text,
      length: unit.length,
      sourceName,
    })
  }
  return { value: amount, unit: unit.toLowerCase() }
}

function parsePackage(fieldLines: RawLine[], sourceName: string): PackageInfo {
  const values = readFields(fieldLines, PACKAGE_FIELDS, sourceName)
  requireFields(values, PACKAGE_FIELDS, fieldLines, 'package', sourceName)

  const serviceField = values.get('service')!
  const service = serviceField.value.toLowerCase()
  if (!SERVICE_LEVELS.includes(service as (typeof SERVICE_LEVELS)[number])) {
    throw new LabelSyntaxError({
      message: `unknown service level "${serviceField.value}", expected one of ${SERVICE_LEVELS.map((s) => `"${s}"`).join(', ')}`,
      line: serviceField.line.lineNumber,
      column: serviceField.valueColumn,
      lineText: serviceField.line.text,
      length: serviceField.value.length,
      sourceName,
    })
  }

  return {
    weight: parseMeasurement(values.get('weight')!, ['lb', 'kg'], sourceName) as PackageInfo['weight'],
    length: parseMeasurement(values.get('length')!, ['in', 'cm'], sourceName) as PackageInfo['length'],
    width: parseMeasurement(values.get('width')!, ['in', 'cm'], sourceName) as PackageInfo['width'],
    height: parseMeasurement(values.get('height')!, ['in', 'cm'], sourceName) as PackageInfo['height'],
    service: service as PackageInfo['service'],
  }
}

/**
 * Parses a shipping label document. `sourceName` is only used to label
 * the file/document in error output (e.g. "orders/1042.slbl").
 */
export function parseLabel(source: string, sourceName = 'label'): ShippingLabel {
  const lines = splitLines(source)
  const blocks = new Map<string, RawLine[]>()
  let currentBlockName: string | null = null

  for (const line of lines) {
    if (line.indent === 0) {
      if (!line.content.endsWith(':')) {
        throw new LabelSyntaxError({
          message: `expected a block header ending in ':' (e.g. "from:")`,
          line: line.lineNumber,
          column: 1,
          lineText: line.text,
          length: line.content.length,
          sourceName,
        })
      }
      const name = line.content.slice(0, -1).trim()
      if (!BLOCK_NAMES.includes(name as (typeof BLOCK_NAMES)[number])) {
        throw new LabelSyntaxError({
          message: `unknown block "${name}", expected one of ${BLOCK_NAMES.map((b) => `"${b}"`).join(', ')}`,
          line: line.lineNumber,
          column: 1,
          lineText: line.text,
          length: name.length,
          sourceName,
        })
      }
      if (blocks.has(name)) {
        throw new LabelSyntaxError({
          message: `duplicate block "${name}"`,
          line: line.lineNumber,
          column: 1,
          lineText: line.text,
          length: name.length,
          sourceName,
        })
      }
      blocks.set(name, [])
      currentBlockName = name
    } else {
      if (currentBlockName === null) {
        throw new LabelSyntaxError({
          message: `indented line has no block header above it`,
          line: line.lineNumber,
          column: line.indent + 1,
          lineText: line.text,
          length: line.content.length,
          sourceName,
        })
      }
      blocks.get(currentBlockName)!.push(line)
    }
  }

  for (const required of BLOCK_NAMES) {
    if (blocks.has(required)) continue
    const anchor = lines[lines.length - 1]
    throw new LabelSyntaxError({
      message: `missing required block "${required}"`,
      line: anchor ? anchor.lineNumber : 1,
      column: 1,
      lineText: anchor ? anchor.text : '',
      length: 1,
      sourceName,
    })
  }

  return {
    from: parseAddress(blocks.get('from')!, 'the "from" address', sourceName),
    to: parseAddress(blocks.get('to')!, 'the "to" address', sourceName),
    package: parsePackage(blocks.get('package')!, sourceName),
  }
}
