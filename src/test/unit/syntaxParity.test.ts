/**
 * Runs the analyzer suites again with the syntax engine: rules with a syntax detector must still
 * find everything the regular expressions find in these samples (fragments that do not parse fall
 * back to the regular expressions).
 */
import { before } from 'node:test';
import { useSyntaxEngine } from './helpers';
import { loadSyntaxEngine } from './syntaxEngine';

before(async () => useSyntaxEngine(await loadSyntaxEngine()));

require('./analyzer-cpp.test');
require('./analyzer-c.test');
require('./coreRules.test');
