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
