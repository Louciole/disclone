/**
 * Unified Formula Engine
 *
 * Supports two equivalent syntaxes:
 *   {{SUM(A1, A2)}}          — brace syntax (used in note blocks, showcase, etc.)
 *   =SUM(A1:A2)              — spreadsheet syntax (used in database cells)
 *
 * Both compile down to the same function call pipeline.
 *
 * Cell references (A1, B3, etc.) are resolved via a contextResolver callback
 * that maps column-letter + row-number to actual cell values.
 *
 * Cross-database references use DB("Database Name").A1 syntax,
 * resolved by the contextResolver (not the engine itself).
 */

// ─── Function Registry ────────────────────────────────────────────────

const functions = {}

export function registerFunction(name, fn) {
    functions[name.toUpperCase()] = fn
}

// ─── Built-in Aggregation Functions ───────────────────────────────────

registerFunction('SUM', (...args) => {
    const nums = args.flat(Infinity).map(Number).filter(n => !isNaN(n))
    return nums.reduce((a, b) => a + b, 0)
})

registerFunction('AVG', (...args) => {
    const nums = args.flat(Infinity).map(Number).filter(n => !isNaN(n))
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
})

registerFunction('COUNT', (...args) => {
    return args.flat(Infinity).filter(v => v !== '' && v !== null && v !== undefined).length
})

registerFunction('MIN', (...args) => {
    const nums = args.flat(Infinity).map(Number).filter(n => !isNaN(n))
    return nums.length ? Math.min(...nums) : 0
})

registerFunction('MAX', (...args) => {
    const nums = args.flat(Infinity).map(Number).filter(n => !isNaN(n))
    return nums.length ? Math.max(...nums) : 0
})

registerFunction('IF', (condition, ifTrue, ifFalse) => {
    return condition ? ifTrue : ifFalse
})

registerFunction('CONCAT', (...args) => {
    return args.flat(Infinity).join('')
})

// ─── Cell Reference Utilities ─────────────────────────────────────────

/**
 * Convert column index (0-based) to letter: 0→A, 1→B, ..., 25→Z, 26→AA
 */
export function colIndexToLetter(index) {
    let letter = ''
    while (index >= 0) {
        letter = String.fromCharCode(65 + (index % 26)) + letter
        index = Math.floor(index / 26) - 1
    }
    return letter
}

/**
 * Convert column letter to index (0-based): A→0, B→1, ..., Z→25, AA→26
 */
export function colLetterToIndex(letter) {
    let index = 0
    for (let i = 0; i < letter.length; i++) {
        index = index * 26 + (letter.charCodeAt(i) - 64)
    }
    return index - 1
}

/**
 * Expand a range reference like A1:A3 into individual cell refs [A1, A2, A3]
 */
export function expandRange(rangeStr) {
    const match = rangeStr.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!match) return [rangeStr]

    const [, startCol, startRow, endCol, endRow] = match
    const startColIdx = colLetterToIndex(startCol)
    const endColIdx = colLetterToIndex(endCol)
    const startRowNum = parseInt(startRow)
    const endRowNum = parseInt(endRow)

    const refs = []
    for (let c = startColIdx; c <= endColIdx; c++) {
        for (let r = startRowNum; r <= endRowNum; r++) {
            refs.push(colIndexToLetter(c) + r)
        }
    }
    return refs
}

/**
 * Resolve cell references in an expression using a context resolver.
 * contextResolver(cellRef, dbName?) → value
 *
 * Handles:
 *   - Cross-database refs: DB("Name").A1 or DB("Name").A1:A3
 *   - Range expansion: A1:A3 → individual values
 *   - Single cell refs: A1, B2, etc.
 */
export function resolveReferences(expression, contextResolver) {
    if (!expression || typeof expression !== 'string') return expression

    // Apply reference replacement only outside quoted string literals.
    // This preserves formulas like CONCAT("A1") where A1 is plain text.
    const mapOutsideStrings = (text, transform) => {
        let result = ''
        let i = 0

        while (i < text.length) {
            const ch = text[i]
            if (ch === '"' || ch === "'") {
                const quote = ch
                let literal = quote
                i += 1

                while (i < text.length) {
                    const cur = text[i]
                    literal += cur
                    if (cur === '\\' && i + 1 < text.length) {
                        i += 1
                        literal += text[i]
                    } else if (cur === quote) {
                        i += 1
                        break
                    }
                    i += 1
                }

                result += literal
                continue
            }

            const start = i
            while (i < text.length && text[i] !== '"' && text[i] !== "'") i += 1
            result += transform(text.slice(start, i))
        }

        return result
    }

    // Handle cross-database references: DB("Name").A1 or DB("Name").A1:A3
    expression = mapOutsideStrings(
        expression,
        segment => segment.replace(
            /DB\(["']([^"']+)["']\)\.([A-Z]+\d+(?::[A-Z]+\d+)?)/g,
            (_, dbName, cellRange) => {
                const refs = expandRange(cellRange)
                return refs.map(ref => contextResolver(ref, dbName) ?? '').join(',')
            }
        )
    )

    // Handle range references: A1:A3 → expanded values
    expression = mapOutsideStrings(
        expression,
        segment => segment.replace(
            /([A-Z]+\d+):([A-Z]+\d+)/g,
            (match) => {
                const refs = expandRange(match)
                return refs.map(ref => contextResolver(ref) ?? '').join(',')
            }
        )
    )

    // Handle single cell references: A1, B2, etc. (must contain at least one digit)
    expression = mapOutsideStrings(
        expression,
        segment => segment.replace(
            /\b([A-Z]+\d+)\b/g,
            (match) => {
                const value = contextResolver(match)
                return value !== undefined && value !== null ? value : ''
            }
        )
    )

    return expression
}

// ─── Spreadsheet → Brace Syntax Compiler ──────────────────────────────

/**
 * Convert spreadsheet formula syntax to brace syntax:
 *   =SUM(A1:A3) → {{SUM(A1:A3)}}
 */
export function formulaToBrace(formula) {
    if (!formula || typeof formula !== 'string') return formula
    const trimmed = formula.trim()
    if (!trimmed.startsWith('=')) return formula
    return '{{' + trimmed.slice(1) + '}}'
}

// ─── Parser ───────────────────────────────────────────────────────────

export function parseFunctions(text) {
    const result = []
    let i = 0

    while (i < text.length) {
        const start = text.indexOf('{{', i)
        if (start === -1) {
            result.push({ type: 'text', content: text.substring(i) })
            break
        }

        if (start > i) {
            result.push({ type: 'text', content: text.substring(i, start) })
        }

        let depth = 0
        let end = -1
        for (let j = start; j < text.length - 1; j++) {
            if (text[j] === '{' && text[j + 1] === '{') {
                depth++
                j++
            } else if (text[j] === '}' && text[j + 1] === '}') {
                depth--
                if (depth === 0) {
                    end = j + 2
                    break
                }
                j++
            }
        }

        if (end === -1) {
            result.push({ type: 'text', content: text.substring(start) })
            break
        }

        const inner = text.substring(start + 2, end - 2)
        const funcMatch = inner.match(/^([A-Z_]+)\(([\s\S]*)\)$/)
        if (funcMatch) {
            result.push({ type: 'function', name: funcMatch[1], args: parseArguments(funcMatch[2].trim()) })
        } else {
            result.push({ type: 'text', content: text.substring(start, end) })
        }

        i = end
    }

    return result
}

export function parseArguments(argsString) {
    const args = []
    if (!argsString) return args

    let currentArg = ''
    let inString = false
    let stringChar = null
    let parenDepth = 0
    let braceDepth = 0

    for (let i = 0; i < argsString.length; i++) {
        const char = argsString[i]

        if (inString) {
            if (char === '\\' && i + 1 < argsString.length) {
                currentArg += char + argsString[++i]
            } else if (char === stringChar) {
                inString = false
                stringChar = null
                currentArg += char
            } else {
                currentArg += char
            }
        } else {
            if (char === '"' || char === "'") {
                inString = true
                stringChar = char
                currentArg += char
            } else if (char === '(') {
                parenDepth++
                currentArg += char
            } else if (char === ')') {
                parenDepth--
                currentArg += char
            } else if (char === '{' && argsString[i + 1] === '{') {
                braceDepth++
                currentArg += char
            } else if (char === '}' && argsString[i + 1] === '}') {
                braceDepth--
                currentArg += char
            } else if (char === ',' && parenDepth === 0 && braceDepth === 0) {
                const trimmed = currentArg.trim()
                if (trimmed) args.push(parseArgument(trimmed))
                currentArg = ''
            } else {
                currentArg += char
            }
        }
    }

    const trimmed = currentArg.trim()
    if (trimmed) args.push(parseArgument(trimmed))

    return args
}

export function parseArgument(arg) {
    arg = arg.trim()

    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        return arg.slice(1, -1)
    }

    if (arg === 'true') return true
    if (arg === 'false') return false

    if (!isNaN(arg) && arg !== '') return parseFloat(arg)

    // Nested function call
    const nestedMatch = arg.match(/^([A-Z_]+)\(([\s\S]*)\)$/)
    if (nestedMatch) {
        const func = functions[nestedMatch[1]]
        if (func) {
            return func(...parseArguments(nestedMatch[2].trim()))
        }
    }

    return arg
}

export function evaluateFunctions(contentArray) {
    let content = ""
    contentArray.forEach(part => {
        if (part.type === "text") {
            content += part.content
        } else if (part.type === "function") {
            const func = functions[part.name]
            if (func) {
                content += func(...part.args)
            } else {
                console.warn("Unknown function:", part.name)
            }
        }
    })
    return content
}

function evaluateInnerExpression(inner) {
    const trimmed = String(inner || '').trim()
    if (!trimmed) return ''

    // First evaluate any known FUNCTION(...) calls inside the expression.
    // We repeatedly collapse innermost calls so mixed formulas like
    // SUM(A1:A2)+3 become 3+3 before arithmetic evaluation.
    let expr = trimmed
    while (true) {
        let changed = false
        expr = expr.replace(/([A-Z_]+)\(([^()]*)\)/g, (match, fnName, rawArgs) => {
            const fn = functions[fnName]
            if (!fn) return match
            changed = true
            try {
                const value = fn(...parseArguments(rawArgs.trim()))
                return String(value)
            } catch (_) {
                return '#ERROR'
            }
        })
        if (!changed) break
    }

    // Then evaluate arithmetic expressions when the content is strictly numeric/operators.
    // This avoids executing arbitrary code while supporting formulas like A1+A2.
    const arithmeticOnly = /^[0-9+\-*/%^().\s]+$/
    if (arithmeticOnly.test(expr) && /[+\-*/%^]/.test(expr)) {
        try {
            const normalized = expr.replace(/\^/g, '**')
            const result = Function('"use strict"; return (' + normalized + ')')()
            return result === undefined || result === null ? '' : result
        } catch (_) {
            return '#ERROR'
        }
    }

    return expr
}

// ─── High-level API ───────────────────────────────────────────────────

/**
 * Evaluate a formula expression in a database cell context.
 *
 * @param {string} formula - e.g. "=SUM(A1:A3)" or "{{SUM(A1, A2)}}" or plain "hello"
 * @param {Function} contextResolver - (cellRef, dbName?) → value
 * @returns {string} The evaluated result
 */
export function evaluateFormula(formula, contextResolver) {
    if (!formula || typeof formula !== 'string') return formula || ''

    let expression = formulaToBrace(formula)

    if (!expression.includes('{{')) return formula

    // Resolve cell references within each {{...}} block
    expression = expression.replace(/\{\{([\s\S]*?)\}\}/g, (_, inner) => {
        const resolved = resolveReferences(inner, contextResolver)
        return String(evaluateInnerExpression(resolved))
    })

    return expression
}

/**
 * Evaluate text containing {{FUNCTION()}} calls (used by MDToRender).
 */
export function evaluateText(text) {
    return evaluateFunctions(parseFunctions(text))
}
