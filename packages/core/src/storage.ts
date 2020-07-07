import assert from 'assert';
import { SolcOutput } from './solc-api';
import { isNodeType, findAll } from 'solidity-ast/utils';
import { ContractDefinition, VariableDeclaration } from 'solidity-ast';

import { levenshtein } from './levenshtein';

export interface StorageItem {
  contract: string;
  label: string;
  type: string;
}

export interface TypeItem {
  label: string;
}

export interface StorageLayout {
  storage: StorageItem[];
  types: Record<string, TypeItem>;
}

export function extractStorageLayout(contractDef: ContractDefinition): StorageLayout {
  const layout: StorageLayout = { storage: [], types: {} };

  for (const varDecl of contractDef.nodes) {
    if (isNodeType('VariableDeclaration', varDecl)) {
      if (!varDecl.constant && varDecl.mutability !== 'immutable') {
        const { typeIdentifier, typeString } = varDecl.typeDescriptions;
        assert(typeof typeIdentifier === 'string');
        assert(typeof typeString === 'string');
        const type = decodeTypeIdentifier(typeIdentifier);
        layout.storage.push({
          contract: contractDef.name,
          label: varDecl.name,
          type,
        });
        layout.types[type] = {
          label: typeString,
        };
      }
    }
  }

  return layout;
}

export function getStorageUpgradeErrors(original: StorageLayout, updated: StorageLayout) {
  function matchStorageItem(o: StorageItem, u: StorageItem) {
    const nameMatches = o.label === u.label;

    // TODO: type matching should compare struct members, etc.
    const typeMatches = original.types[o.type].label === updated.types[u.type].label;

    if (typeMatches && nameMatches) {
      return 'equal';
    } else if (typeMatches) {
      return 'typechange';
    } else if (nameMatches) {
      return 'rename';
    } else {
      return 'replace';
    }
  }

  const ops = levenshtein(original.storage, updated.storage, matchStorageItem);
  return ops.filter(o => o.action !== 'append');
}

// Type Identifiers contain AST id numbers, which makes them sensitive to
// unrelated changes in the source code. This function stabilizes a type
// identifier by removing all AST ids.
function stabilizeTypeIdentifier(typeIdentifier: string): string {
  let decoded = decodeTypeIdentifier(typeIdentifier);
  const re = /(t_struct|t_enum|t_contract)\(/g;
  let match;
  while (match = re.exec(decoded)) {
    let i;
    let d = 1;
    for (i = match.index + match[0].length; d !== 0; i++) {
      assert(i < decoded.length, 'index out of bounds');
      const c = decoded[i];
      if (c === '(') {
        d += 1;
      } else if (c === ')') {
        d -= 1;
      }
    }
    const re2 = /\d+_?/y;
    re2.lastIndex = i;
    decoded = decoded.replace(re2, '');
  }
  return decoded;
}

// Type Identifiers in the AST are for some reason encoded so that they don't
// contain parentheses or commas, which have been substituted as follows:
//    (  ->  $_
//    )  ->  _$
//    ,  ->  _$_
// This is particularly hard to decode because it is not a prefix-free code.
// Thus, the following regex has to perform a lookahead to make sure it gets
// the substitution right.
function decodeTypeIdentifier(typeIdentifier: string): string {
  return typeIdentifier.replace(/(\$_|_\$_|_\$)(?=(\$_|_\$_|_\$)*([^_$]|$))/g, m => {
    switch (m) {
      case '$_': return '(';
      case '_$': return ')';
      case '_$_': return ',';
      default: throw new Error('Unreachable');
    }
  });
}