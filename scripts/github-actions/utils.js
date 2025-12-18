#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

const isCI = () => process.env.CI === 'true';

// Simple Error logger that works in GHA and locally
const errorAndExit = (msg) => {
  const prefix = isCI() ? '::error::' : '\x1b[31m[Error]\x1b[0m ';
  console.log(`${prefix}${msg}`);
  // Exit code 1 stops CI, 0 prevents closing terminal
  process.exit(isCI() ? 1 : 0);
};

// Validate user provided major version is valid
const validateNewMajor = () => {
  const major = process.env.NEW_MAJOR;
  if (!major) return;
  if (major.includes('.') || isNaN(parseInt(major))) errorAndExit(`Invalid NEW_MAJOR value (${major}). Must be a whole number`);
  return parseInt(major);
}

const parseSemver = (version) => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return errorAndExit(`Invalid version format: ${version}`);
  const [semver, major, minor, patch, prerelease] = match;
  if (prerelease) return errorAndExit('Prerelease versions (e.g. 1.2.3-beta.0) are not currently supported in the VSCode Marketplace');
  return { semver, major: parseInt(major), minor: parseInt(minor), patch: parseInt(patch) };
};

// If running in CI, append the GHA output variable to be used in later steps
// If not running in CI, log to console instead.
const setGhaOutput = (key, value) => {
  if (isCI()) {
    // Append to the file path specified by GITHUB_OUTPUT
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  } else {
    // Script is running locally (where GITHUB_OUTPUT is undefined)
    console.log('Script is running locally, GITHUB_OUTPUT is not defined.');
    console.log('Would have set output to:');
    console.log(`${key}=${value}`);
  }
}

// Get the latest "Pre-Release" version that is published to the VSCode Marketplace
// TODO: If needed elsewhere, this could be reused to get Release or Pre-release depending on a boolean arg.
const getLatestPreReleaseVersionFromMarketplace = (extensionId) => {
  const versionsJson = execSync(`npx vsce show ${extensionId} --json`).toString().trim();

  if (versionsJson === 'undefined') return errorAndExit(`No version info found for ${extensionId}. Run 'npx vsce show ${extensionId} --json' locally to debug.`);

  const preReleaseVersions = JSON.parse(versionsJson).versions.filter(version =>
    version.properties?.some(
      // According to source, we shouldn't need to check for "true" but we will to make this future-proof
      // https://github.com/microsoft/vscode-vsce/blob/d6d2ef0fb7fa47aab455b21f462e899adfacd545/src/show.ts#L72
      prop => prop.key === 'Microsoft.VisualStudio.Code.PreRelease' && prop.value === 'true'
    )
  );

  // TODO: add a temporary bypass for getting the first prerelease published
  if (preReleaseVersions.length === 0) return errorAndExit(`No pre-release versions found for ${extensionId}`);

  // We can assume that these are ordered by lastUpdated descending
  // In source, the showTable function here simply slices the results
  // https://github.com/microsoft/vscode-vsce/blob/main/src/show.ts#L71
  return preReleaseVersions[0].version;
}


const buildNextVersion = (main, marketplace, newMajor) => {
  if (newMajor) {
    if (process.env['FORCE_NEW_MAJOR'] === 'true') {
      console.log(`::warning::FORCE_NEW_MAJOR is set to true. Bypassing new major version checks.`);
    } else {
      if (main.major !== marketplace.major) return errorAndExit(`A new major was passed (${newMajor}), however the major versions in 'main' (${main.semver}) and the 'marketplace' (${marketplace.semver}) already do NOT match. This suggests that a new major was just recently published as a pre-release in the marketplace. Please confirm versions in main and in the marketplace.`)

      // By convention, majors follow Salesforce API versions which increments by 1 each Salesforce Release.
      // If the difference between the new major and the previous major is not 1, something is awry.
      if (newMajor - main.major !== 1) return errorAndExit(`The new major version (${newMajor}) is not exactly 1 greater than the current major version in 'main' (${main.major}). Please confirm the correct new major version.`)

      console.log(`New major version passed validation: ${newMajor}`);
    }

    console.log(`::warning::Setting new major version to ${newMajor}.0.0`);
    return `${newMajor}.0.0`;
  } else {
    if (main.semver === marketplace.semver) {
      console.log(`Versions match (${main.semver}). Promotions likely just ran, we need to bump MINOR version.`);
      return `${main.major}.${main.minor + 1}.0`;
    }

    if (main.major === marketplace.major && main.minor > marketplace.minor) {
      console.log(`Majors match and main minor is greater (${main.semver} > ${marketplace.semver}). Nightly is already ahead, bumping PATCH version`)
      return `${main.major}.${main.minor}.${main.patch + 1}`;
    }

    if (main.major > marketplace.major) {
      console.log(`Main major is already ahead (${main.semver} > ${marketplace.semver}). Bumping PATCH version`)
      return `${main.major}.${main.minor}.${main.patch + 1}`;
    }
  }
}

module.exports = {
  buildNextVersion,
  isCI,
  errorAndExit,
  getLatestPreReleaseVersionFromMarketplace,
  parseSemver,
  setGhaOutput,
  validateNewMajor
};



// Example output from `npx vsce show salesforce.salesforcedx-vscode --json`:
// {
//   "publisher": {
//     "publisherId": "656b996d-3c70-47b4-937e-e77c013faeea",
//     "publisherName": "salesforce",
//     "displayName": "Salesforce",
//     "flags": 2,
//     "domain": "https://salesforce.com",
//     "isDomainVerified": true
//   },
//   "extensionId": "d35d7d8d-7504-48d6-bdfd-8cfd4b6d50ae",
//   "extensionName": "salesforcedx-vscode",
//   "displayName": "Salesforce Extension Pack",
//   "flags": 260,
//   "lastUpdated": "2025-12-11T18:23:07.237Z",
//   "publishedDate": "2017-09-21T16:31:10.537Z",
//   "releaseDate": "2017-09-21T16:31:10.537Z",
//   "shortDescription": "Extensions for developing on the Salesforce Platform",
//   "versions": [
//     {
//       "version": "65.8.2",
//       "flags": 1,
//       "lastUpdated": "2025-12-11T18:23:07.237Z",
//       "properties": [
//         {
//           "key": "Microsoft.VisualStudio.Services.Branding.Color",
//           "value": "#ECECEC"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Branding.Theme",
//           "value": "light"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Links.Getstarted",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode.git"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Links.Support",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode/issues"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Links.Learn",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode#readme"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Links.Source",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode.git"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Links.GitHub",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode.git"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.Engine",
//           "value": "^1.90.0"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown",
//           "value": "true"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.ExtensionDependencies",
//           "value": ""
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.CustomerQnALink",
//           "value": "https://github.com/forcedotcom/salesforcedx-vscode/issues"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.ExtensionPack",
//           "value": "salesforce.salesforcedx-vscode-apex,salesforce.salesforcedx-vscode-apex-testing,salesforce.salesforcedx-vscode-apex-oas,salesforce.salesforcedx-vscode-apex-replay-debugger,salesforce.salesforcedx-einstein-gpt,salesforce.salesforcedx-vscode-core,salesforce.salesforcedx-vscode-lightning,salesforce.salesforcedx-vscode-org,salesforce.salesforcedx-vscode-visualforce,salesforce.salesforcedx-vscode-lwc,salesforce.salesforcedx-vscode-soql,salesforce.salesforce-vscode-slds,salesforce.sfdx-code-analyzer-vscode,salesforce.apex-language-server-extension"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.LocalizedLanguages",
//           "value": ""
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.ExtensionKind",
//           "value": "workspace,web"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Services.Content.Pricing",
//           "value": "Free"
//         },
//         {
//           "key": "Microsoft.VisualStudio.Code.EnabledApiProposals",
//           "value": ""
//         }
//       ]
//     },
//     { ... lots more versions ... }
//  ],
// 	"categories": [
// 		"Extension Packs"
// 	],
// 	"tags": [
// 		"__web_extension"
// 	],
// 	"statistics": [
// 		{
// 			"statisticName": "install",
// 			"value": 1733047
// 		},
// 		{
// 			"statisticName": "averagerating",
// 			"value": 2.6440677642822266
// 		},
// 		{
// 			"statisticName": "ratingcount",
// 			"value": 59
// 		},
// 		{
// 			"statisticName": "trendingdaily",
// 			"value": 0.0005193872845913374
// 		},
// 		{
// 			"statisticName": "trendingmonthly",
// 			"value": 1.2545511310812316
// 		},
// 		{
// 			"statisticName": "trendingweekly",
// 			"value": 0.25057550996617634
// 		},
// 		{
// 			"statisticName": "updateCount",
// 			"value": 23922577
// 		},
// 		{
// 			"statisticName": "weightedRating",
// 			"value": 2.9059683199258837
// 		},
// 		{
// 			"statisticName": "downloadCount",
// 			"value": 35901
// 		}
// 	],
// 	"deploymentType": 0
// }

//
