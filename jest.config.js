/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  "testMatch": [
    "<rootDir>/**/?(*.)+(spec|test).ts?(x)"
  ],
  "transform": {
    "^.+\\.tsx?$": "ts-jest"
  },
  "moduleFileExtensions": [
    "ts",
    "tsx",
    "js",
    "jsx",
    "json",
    "node"
  ]
};
