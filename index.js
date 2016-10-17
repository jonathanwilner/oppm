'use strict';

const packageJson = require('./package.json');
const config = require('./config/main');
const plugins = require('./config/plugins/plugins_index');
const wizardQuestions = require('./config/questions').wizardQuestions;
const fs = require('fs-extra');
const path = require('path');
const copyFile = require('es6-promisify')(fs.copy);
const parseArgs = require('minimist');
const versionManager = require('./lib/version_manager');
const resourceManager = require('./lib/resource_manager');
const packageManager = require('./lib/package_manager');
const pluginUtils = require('./lib/plugin_utils');
const samplePage = require('./lib/sample_page');
const inquirer = require('inquirer');
const Spinner = require('cli-spinner').Spinner;
const chalk = require('chalk');

const BUILD_TYPES = require('./lib/const/build_types');

/**
 * Parses all the command line arguments and assigns default values.
 * @return {object} An object with all of the sanitized arguments
 */
const getParameters = () => {
  const options = {
    default: {
      version: 'latest',
      candidate: false
    }
  };
  return parseArgs(process.argv.slice(2), options);
};

/**
 * Main entry point of the application.
 */
const app = () => {
  const params = getParameters();
  const buildType = params.candidate ? BUILD_TYPES.CANDIDATE : BUILD_TYPES.STABLE;

  console.log(chalk.cyan(`Ooyala Package Manager v${packageJson.version}`));
  const spinner = new Spinner('%s Fetching version information...');
  spinner.start();

  versionManager.resolveVersionNumber(params.version, buildType)
  .then((version) => {
    // If these are different it means that we already called the server in order
    // to get the version number, so we do not need to validate it
    if (params.version === version) {
      return versionManager.validatePlayerVersion(params.version, buildType);
    }
    params.version = version;
    return Promise.resolve();
  })
  .then(() => {
    spinner.stop(true);
    console.log(chalk.white(`Player V4 Version: ${params.version} (${buildType})`));
    return inquirer.prompt(wizardQuestions(params.version));
  })
  .then(answers => runPackageManager(params, buildType, answers))
  .catch((error) => {
    console.log(chalk.red(error.message));
  });
};

/**
 * Downloads resources and builds a package with the given options.
 * @param {object} params Command line arguments that were passed
 * @param {string} buildType Either 'candidate' or 'stable'
 * @param {object} options An object that contains all the options that were selected for the package build. Mostly the info about plugins to include
 * @returns {Promise} A promise that is resolved when the operation is completed
 */
const runPackageManager = (params, buildType, options) => {
  const mainBuildPath = path.join(config.BUILD_PATH, params.version);
  const bundleBuildPath = `${mainBuildPath}_bundle`;
  const packageSourcePath = options.bundle ? bundleBuildPath : mainBuildPath;

  return new Promise((resolve, reject) => {
    // Determine whether skin.json was amongst the chosen options
    const skinIncluded = (options.skin || []).some(pluginId => pluginId === 'skin-json');
    // Filter plugin assets and obtain a list all required files and dependencies
    const resources = resourceManager.filterPluginResources(plugins, params.version, buildType, options);

    fs.emptyDirSync(config.BUILD_PATH);

    resourceManager.downloadResources(resources, mainBuildPath, true)
    .then(() => {
      if (!skinIncluded) {
        return Promise.resolve();
      }
      const skinJson = plugins.skinPlugins.plugins.find(plugin => plugin.id === 'skin-json');
      const skinJsonFilePath = path.join(mainBuildPath, skinJson.path, skinJson.fileName);
      return pluginUtils.relativizeSkinJsonUrls(skinJsonFilePath, skinJson.dependencies);
    })
    .then(() => {
      if (!options.bundle) {
        return Promise.resolve();
      }
      return packageManager.generateManifest(mainBuildPath, config.MANIFEST_FILE, resources);
    })
    .then(() => {
      if (!options.bundle) {
        return Promise.resolve();
      }
      const entry = { path: mainBuildPath, fileName: config.MANIFEST_FILE };
      const output = { path: bundleBuildPath, fileName: 'bundle.js' };
      return packageManager.bundleResources(entry, output);
    })
    .then(() => {
      const pageOptions = {
        version: params.version,
        isBundle: options.bundle,
        skinIncluded,
        skinFallbackUrls: {
          css: `${config.RESOURCE_ROOT}/${buildType}/${params.version}/skin-plugin/html5-skin.min.css`,
          json: `${config.RESOURCE_ROOT}/${buildType}/${params.version}/skin-plugin/skin.json`
        }
      };
      return samplePage.create(packageSourcePath, 'sample.htm', resources, pageOptions);
    })
    .then(() =>
      copyFile(path.join('templates', 'run_sample.js'), path.join(packageSourcePath, 'run_sample.js'))
    )
    .then(() =>
      packageManager.createPackageArchive(packageSourcePath, options.outputPath, `Player_V${params.version}`)
    )
    .then((pkg) => {
      console.log(chalk.green('Package', chalk.bold(pkg.fileName), 'created at', chalk.bold(pkg.path)));
      resolve(pkg);
    })
    .catch(error => reject(error));
  });
};

app();
