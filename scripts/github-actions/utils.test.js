/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

const fs = require('fs');
const { execSync } = require('child_process');
const {
  buildNextVersion,
  isCI,
  errorAndExit,
  validateNewMajor,
  parseSemver,
  getLatestPreReleaseVersionFromMarketplace,
  setGhaOutput
} = require('./utils');

// Mock child_process and fs
jest.mock('child_process');
jest.mock('fs');

// Shared test setup
const originalEnv = process.env;
let consoleSpy;
let exitSpy;

beforeEach(() => {
  // Fresh env for each test
  process.env = { ...originalEnv };

  // Mock console.log and process.exit
  // jest.spyOn(object, 'method') is like sinon.stub(object, 'method')
  // .mockImplementation(() => {}) is like sinon's .callsFake()
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
});

afterEach(() => {
  // Restore mocks - like sinon's sandbox.restore()
  consoleSpy.mockRestore();
  exitSpy.mockRestore();
});

afterAll(() => {
  process.env = originalEnv;
});

describe('isCI', () => {
  // Jest assertion cheat sheet:
  // expect(value).toBe(expected)  is like  expect(value).to.equal(expected)
  // expect(value).toEqual(expected)  is like  expect(value).to.deep.equal(expected)

  it('returns true when CI env var is "true"', () => {
    process.env.CI = 'true';
    expect(isCI()).toBe(true);
  });

  it('returns false when CI env var is "false"', () => {
    process.env.CI = 'false';
    expect(isCI()).toBe(false);
  });

  it('returns false when CI env var is undefined', () => {
    delete process.env.CI;
    expect(isCI()).toBe(false);
  });

  it('returns false when CI env var is empty string', () => {
    process.env.CI = '';
    expect(isCI()).toBe(false);
  });

  it('returns false when CI is "TRUE" (case sensitive)', () => {
    process.env.CI = 'TRUE';
    expect(isCI()).toBe(false);
  });
});

describe('errorAndExit', () => {
  describe('in CI environment', () => {
    beforeEach(() => {
      process.env.CI = 'true';
    });

    it('logs message with GitHub Actions error prefix', () => {
      errorAndExit('Something went wrong');

      // toHaveBeenCalledWith is like sinon's calledWith
      expect(consoleSpy).toHaveBeenCalledWith('::error::Something went wrong');
    });

    it('exits with code 1', () => {
      errorAndExit('Something went wrong');

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('in local environment', () => {
    beforeEach(() => {
      delete process.env.CI;
    });

    it('logs message with colored error prefix', () => {
      errorAndExit('Something went wrong');

      // \x1b[31m is red, \x1b[0m resets color
      expect(consoleSpy).toHaveBeenCalledWith('\x1b[31m[Error]\x1b[0m Something went wrong');
    });

    it('exits with code 0 (to prevent terminal from closing)', () => {
      errorAndExit('Something went wrong');

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});

describe('validateNewMajor', () => {
  it('returns undefined when NEW_MAJOR is not set', () => {
    delete process.env.NEW_MAJOR;
    expect(validateNewMajor()).toBeUndefined();
  });

  it('returns undefined when NEW_MAJOR is empty string', () => {
    process.env.NEW_MAJOR = '';
    expect(validateNewMajor()).toBeUndefined();
  });

  it('returns parsed integer when NEW_MAJOR is a valid whole number', () => {
    process.env.NEW_MAJOR = '66';
    expect(validateNewMajor()).toBe(66);
  });

  it('returns parsed integer for single digit', () => {
    process.env.NEW_MAJOR = '5';
    expect(validateNewMajor()).toBe(5);
  });

  it('calls errorAndExit when NEW_MAJOR contains a decimal point', () => {
    process.env.NEW_MAJOR = '66.0';
    validateNewMajor();

    expect(exitSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid NEW_MAJOR value (66.0)')
    );
  });

  it('calls errorAndExit when NEW_MAJOR is not a number', () => {
    process.env.NEW_MAJOR = 'abc';
    validateNewMajor();

    expect(exitSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid NEW_MAJOR value (abc)')
    );
  });

  it('calls errorAndExit when NEW_MAJOR is a semver string', () => {
    process.env.NEW_MAJOR = '66.1.0';
    validateNewMajor();

    expect(exitSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Invalid NEW_MAJOR value (66.1.0)')
    );
  });
});

describe('parseSemver', () => {
  describe('valid versions', () => {
    it('parses standard semver', () => {
      expect(parseSemver('65.8.0')).toEqual({ semver: '65.8.0', major: 65, minor: 8, patch: 0 });
    });

    it('parses single digit versions', () => {
      expect(parseSemver('1.2.3')).toEqual({ semver: '1.2.3', major: 1, minor: 2, patch: 3 });
    });

    it('parses large version numbers', () => {
      expect(parseSemver('100.200.300')).toEqual({ semver: '100.200.300', major: 100, minor: 200, patch: 300 });
    });

    it('parses version with zeros', () => {
      expect(parseSemver('0.0.0')).toEqual({ semver: '0.0.0', major: 0, minor: 0, patch: 0 });
    });
  });

  describe('invalid versions', () => {
    it('calls errorAndExit for prerelease versions', () => {
      parseSemver('1.2.3-beta.0');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Prerelease versions')
      );
    });

    it('calls errorAndExit for prerelease with simple tag', () => {
      parseSemver('1.2.3-alpha');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Prerelease versions')
      );
    });

    it('calls errorAndExit for missing patch version', () => {
      parseSemver('1.2');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid version format: 1.2')
      );
    });

    it('calls errorAndExit for missing minor and patch', () => {
      parseSemver('1');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid version format: 1')
      );
    });

    it('calls errorAndExit for non-numeric version', () => {
      parseSemver('a.b.c');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid version format: a.b.c')
      );
    });

    it('calls errorAndExit for empty string', () => {
      parseSemver('');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid version format:')
      );
    });

    it('calls errorAndExit for version without dots', () => {
      parseSemver('123');

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid version format: 123')
      );
    });
  });
});

describe('getLatestPreReleaseVersionFromMarketplace', () => {
  // Simplified mock of `npx vsce show <extensionId> --json` response
  // Only includes fields the function actually uses
  const createMockResponse = (versions) => JSON.stringify({ versions });

  const createVersion = (version, isPreRelease = false) => ({
    version,
    properties: isPreRelease
      ? [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
      : []
  });

  beforeEach(() => {
    execSync.mockReset();
  });

  it('returns the latest pre-release version', () => {
    const mockResponse = createMockResponse([
      createVersion('65.9.0', true),  // Latest pre-release (first in array)
      createVersion('65.8.0', true),
      createVersion('65.7.0', false), // Regular release
    ]);
    execSync.mockReturnValue(Buffer.from(mockResponse));

    const result = getLatestPreReleaseVersionFromMarketplace('salesforce.salesforcedx-vscode');

    expect(result).toBe('65.9.0');
    expect(execSync).toHaveBeenCalledWith('npx vsce show salesforce.salesforcedx-vscode --json');
  });

  it('skips non-pre-release versions to find the latest pre-release', () => {
    const mockResponse = createMockResponse([
      createVersion('65.9.0', false), // Latest but not pre-release
      createVersion('65.8.0', false),
      createVersion('65.7.0', true),  // This should be returned
    ]);
    execSync.mockReturnValue(Buffer.from(mockResponse));

    const result = getLatestPreReleaseVersionFromMarketplace('salesforce.salesforcedx-vscode');

    expect(result).toBe('65.7.0');
  });

  it('calls errorAndExit when vsce returns "undefined"', () => {
    execSync.mockReturnValue(Buffer.from('undefined'));

    getLatestPreReleaseVersionFromMarketplace('some.extension');

    expect(exitSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No version info found for some.extension')
    );
  });

  it('calls errorAndExit when no pre-release versions exist', () => {
    const mockResponse = createMockResponse([
      createVersion('65.9.0', false),
      createVersion('65.8.0', false),
    ]);
    execSync.mockReturnValue(Buffer.from(mockResponse));

    getLatestPreReleaseVersionFromMarketplace('salesforce.salesforcedx-vscode');

    expect(exitSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('No pre-release versions found')
    );
  });

  it('handles versions with no properties array', () => {
    const mockResponse = JSON.stringify({
      versions: [
        { version: '65.9.0' }, // No properties
        createVersion('65.8.0', true),
      ]
    });
    execSync.mockReturnValue(Buffer.from(mockResponse));

    const result = getLatestPreReleaseVersionFromMarketplace('salesforce.salesforcedx-vscode');

    expect(result).toBe('65.8.0');
  });
});

describe('setGhaOutput', () => {
  beforeEach(() => {
    fs.appendFileSync.mockReset();
  });

  describe('in CI environment', () => {
    beforeEach(() => {
      process.env.CI = 'true';
      process.env.GITHUB_OUTPUT = '/path/to/github/output';
    });

    it('appends key=value to GITHUB_OUTPUT file', () => {
      setGhaOutput('new_nightly_version', '65.9.0');

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        '/path/to/github/output',
        'new_nightly_version=65.9.0\n'
      );
    });

    it('does not log to console', () => {
      setGhaOutput('new_nightly_version', '65.9.0');

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('in local environment', () => {
    beforeEach(() => {
      delete process.env.CI;
      delete process.env.GITHUB_OUTPUT;
    });

    it('does not write to file', () => {
      setGhaOutput('new_nightly_version', '65.9.0');

      expect(fs.appendFileSync).not.toHaveBeenCalled();
    });

    it('logs informational message to console', () => {
      setGhaOutput('new_nightly_version', '65.9.0');

      expect(consoleSpy).toHaveBeenCalledWith('Script is running locally, GITHUB_OUTPUT is not defined.');
      expect(consoleSpy).toHaveBeenCalledWith('Would have set output to:');
      expect(consoleSpy).toHaveBeenCalledWith('new_nightly_version=65.9.0');
    });
  });
});

describe('buildNextVersion', () => {
  describe('without newMajor', () => {
    it('bumps MINOR when main and marketplace versions match', () => {
      const main = parseSemver('65.8.0');
      const marketplace = parseSemver('65.8.0');

      expect(buildNextVersion(main, marketplace, undefined)).toBe('65.9.0');
    });

    it('bumps PATCH when main minor is greater than marketplace', () => {
      const main = parseSemver('65.9.0');
      const marketplace = parseSemver('65.8.0');

      expect(buildNextVersion(main, marketplace, undefined)).toBe('65.9.1');
    });

    // Test case: The nightly workflow was recently ran with a newMajor.
    // Main is on the next major, but it has not yet been promoted in the marketplace
    // The correct next version is to bump the patch on the new major
    it('bumps PATCH when main major is already ahead', () => {
      const main = parseSemver('66.0.0');
      const marketplace = parseSemver('65.8.0');

      expect(buildNextVersion(main, marketplace, undefined)).toBe('66.0.1');
    });

    it('bumps PATCH correctly when patch is already > 0', () => {
      const main = parseSemver('65.9.5');
      const marketplace = parseSemver('65.8.0');

      expect(buildNextVersion(main, marketplace, undefined)).toBe('65.9.6');
    });
  });

  describe('with newMajor', () => {
    beforeEach(() => {
      delete process.env.FORCE_NEW_MAJOR;
    });

    it('returns new major version when validation passes', () => {
      const main = parseSemver('65.8.0');
      const marketplace = parseSemver('65.8.0');

      expect(buildNextVersion(main, marketplace, 66)).toBe('66.0.0');
    });

    it('calls errorAndExit when main and marketplace majors do not match', () => {
      const main = parseSemver('66.0.0');
      const marketplace = parseSemver('65.8.0');

      buildNextVersion(main, marketplace, 67);

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('major versions')
      );
    });

    it('calls errorAndExit when newMajor is not exactly 1 greater than main', () => {
      const main = parseSemver('65.8.0');
      const marketplace = parseSemver('65.8.0');

      buildNextVersion(main, marketplace, 68); // 68 is too far ahead

      expect(exitSpy).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not exactly 1 greater')
      );
    });

    describe('with FORCE_NEW_MAJOR', () => {
      beforeEach(() => {
        process.env.FORCE_NEW_MAJOR = 'true';
      });

      it('bypasses validation checks', () => {
        const main = parseSemver('65.8.0');
        const marketplace = parseSemver('64.0.0'); // Majors don't match

        // Would normally fail, but FORCE_NEW_MAJOR bypasses
        expect(buildNextVersion(main, marketplace, 99)).toBe('99.0.0');
        expect(exitSpy).not.toHaveBeenCalled();
      });

      it('logs warning about bypassing checks', () => {
        const main = parseSemver('65.8.0');
        const marketplace = parseSemver('65.8.0');

        buildNextVersion(main, marketplace, 66);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('FORCE_NEW_MAJOR')
        );
      });
    });
  });
});
