'use strict';

const fs = require('fs-extra');
const ensureDir = require('es6-promisify')(fs.ensureDir);
const rename = require('es6-promisify')(fs.rename);
const path = require('path');
const archiver = require('archiver');
const semver = require('semver');
const md5File = require('md5-file/promise');
const buildRelativeResourcePath = require('./resource_manager').buildRelativeResourcePath;
const utils = require('./utils.js');

/**
 * Creates a manifest object that separates package contents into bundled and unbundled resources.
 * The returned object is passed as a parameter for <tt>bundleResources</tt>, which in turn uses
 * it to configure the build.
 * @param {string} version The V4 version of the package we're building
 * @param {array} resources An array of resource objects generated by the resource manager
 * @returns {object} An object that lists all of the bundled and unbundled resources
 */
const generateManifest = (version, resources) => {
  const bundledResources = [];
  const unbundledResources = [];

  let canBeBundled = true;
  resources.forEach((resource) => {
    canBeBundled = !resource.bundleableV4Version || semver.satisfies(version, resource.bundleableV4Version);

    if (canBeBundled && resource.fileName.match(/\.(min\.js|js)$/)) {
      bundledResources.push(resource);
    } else {
      unbundledResources.push(resource);
    }
  });
  return { bundledResources, unbundledResources };
};

/**
 * Creates a "bundled" version of the package at <tt>sourcePath</tt>. Files that are specified as
 * "bundled" inside the manifest are concatenated and the rest are copied to the new location using
 * the same directory structure.
 * @param {object} sourcePath The directory where the package source files are located
 * @param {object} output An object containing the path and filename of the bundle to be generated
 * @param {object} bundleManifest An object with a list of the bundled and unbundled resources that comprise the package
 */
const bundleResources = (sourcePath, output, bundleManifest) =>
  new Promise((resolve, reject) => {
    const filesToBundle = (bundleManifest.bundledResources || []).map(
      resource => path.join(sourcePath, buildRelativeResourcePath(resource))
    );
    const filesToCopy = (bundleManifest.unbundledResources || []).map(
      resource => ({
        src: path.join(sourcePath, buildRelativeResourcePath(resource)),
        dest: path.join(output.path, buildRelativeResourcePath(resource, true))
      })
    );
    const bundleFilePath = path.join(output.path, output.fileName);

    let packagedResources = [];

    ensureDir(output.path)
    .then(() => utils.concatFiles(bundleFilePath, filesToBundle))
    .then(() => md5File(bundleFilePath))
    .then((hash) => {
      const bundleFileName = `${hash.substring(0, 20)}.${output.fileName}`;

      packagedResources = [{
        path: '',
        fileName: bundleFileName
      }].concat(bundleManifest.unbundledResources || []);

      return rename(bundleFilePath, path.join(output.path, bundleFileName));
    })
    .then(() => utils.copyFiles(filesToCopy))
    .then(() => resolve(packagedResources))
    .catch(error => reject(new Error(`Failed to bundle package files: ${error}`)));
  });

/**
 * Compresses a whole directory into a .zip file.
 * @param {string} sourcePath The source directory where the package files are located
 * @param {string} destPath The destination directory where the zip archive will be created
 * @param {string} archiveName The name of the archive file that will be created (.zip extension added by default)
 * @returns {Promise} A promise that is resolved when the operation is completed
 */
const createPackageArchive = (sourcePath, destPath, archiveName) =>
  new Promise((resolve, reject) => {
    const archive = archiver.create('zip', {});
    const fileName = `${archiveName}.zip`;
    const filePath = path.join(destPath, fileName);

    const output = fs.createWriteStream(filePath);
    output.on('close', () => resolve({ fileName, path: destPath }));
    output.on('error', () =>
      reject(new Error('Failed to create .zip package. Please make sure you have write permissions on the destination folder.'))
    );

    archive.pipe(output);
    archive.directory(sourcePath, archiveName);
    archive.finalize();
  });

exports.generateManifest = generateManifest;
exports.bundleResources = bundleResources;
exports.createPackageArchive = createPackageArchive;
