#!/usr/bin/env node

const {
  buildNextVersion,
  getLatestPreReleaseVersionFromMarketplace,
  parseSemver,
  setGhaOutput,
  validateNewMajor
} = require('./utils')

// FYI: 'vscjava.vscode-java-pack' has prerelease versions for testing
const latestPreReleaseInMarketplace = getLatestPreReleaseVersionFromMarketplace('salesforce.salesforcedx-vscode');
const currentVersionInMain = require('../../packages/salesforcedx-vscode/package.json').version;

const main = parseSemver(currentVersionInMain);
const marketplace = parseSemver(latestPreReleaseInMarketplace);

// NOTE: newMajor can be only be set from the 'make-pr-for-nightly' workflow dispatch
// TODO: provide link to Action once created
const newMajor = validateNewMajor();

console.log('Version found in Github main branch :', main);
console.log('Pre-release version from marketplace:', marketplace);

// Determine next nightly version
const next = buildNextVersion(main, marketplace, newMajor);

setGhaOutput('new_nightly_version', next);
