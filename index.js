"use strict";

// @IMPORTS
var Application = require("neat-base").Application;
var Module = require("neat-base").Module;
var Tools = require("neat-base").Tools;
var fs = require("fs");
var Promise = require("bluebird");

module.exports = class Projection extends Module {

    static defaultConfig() {
        return {
            dbModuleName: "database",
            projections: {
                user: {
                    list: {
                        name: "username",
                    }
                }
            }
        }
    }

    /**
     *
     */
    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");
            this.initMongoose();
            resolve(this);
        });
    }

    /**
     *
     */
    initMongoose() {
        var self = this;
        var proto = Application.modules[this.config.dbModuleName].mongoose.Query.prototype;
        proto._neatProjectionSavedExec = proto.exec;
        proto.projection = function (pkg, req) {
            this._neatProjectionPackage = pkg;
            this._neatProjectionRequest = req;
            return this;
        };
        proto.project = function(pkg, req) {
            return self.getDocumentProjection(this, pkg, req);
        };
        proto.exec = function () {

            // dont do anything if not active
            if (!this._neatProjectionPackage) {
                return proto._neatProjectionSavedExec.apply(this, arguments);
            }

            // dont do anything on save/count/...
            if ([
                    "find",
                    "findOne"
                ].indexOf(this.op) === -1) {
                return proto._neatProjectionSavedExec.apply(this, arguments);
            }

            return new Promise((resolve, reject) => {
                // first run the regular query
                return proto._neatProjectionSavedExec.apply(this, arguments).then((docs) => {
                    if (this.op === "findOne") {
                        return self.getDocumentProjection(docs, this._neatProjectionPackage, this._neatProjectionRequest);
                    } else {
                        return Promise.map(docs, (doc) => {
                            return self.getDocumentProjection(doc, this._neatProjectionPackage, this._neatProjectionRequest);
                        })
                    }
                }).then(resolve, reject);
            });
        }
    }

    /**
     *
     * @param {Document} doc
     * @param {string} pkg
     * @param {Request} req
     */
    getDocumentProjection(doc, pkg, req) {
        if (!doc) {
            return Promise.resolve({});
        }

        if (!pkg) {
            return Promise.reject(new Error("missing package for projection"));
        }

        var modelName = doc.constructor.modelName;

        if (!this.config.projections[modelName]) {
            return Promise.reject(new Error("No projection configured for model " + modelName));
        }

        if (!this.config.projections[modelName][pkg]) {
            return Promise.reject(new Error("No projection configured for model " + modelName + " and package " + pkg));
        }

        var conf = this.config.projections[modelName][pkg];

        return new Promise((resolve, reject) => {
            var result = {};

            return Promise.map(Object.keys(conf), (field) => {
                return this.getFieldProjection(field, conf[field], doc, req).then((data) => {
                    result[field] = data;
                });
            }).then(() => {
                resolve(result);
            }, reject)
        });
    }

    /**
     *
     * @param {string} field
     * @param {string} config
     * @param {Document} doc
     * @param {Request} req
     */
    getFieldProjection(field, config, doc, req) {
        return new Promise((resolve, reject) => {
            var fields = this.getFieldArrayFromProjectionConfig(config);
            var fieldValue = null;

            return Promise.mapSeries(fields, (field) => {
                return new Promise((resolve, reject) => {
                    // if a value already has been found, skip everything else
                    if (fieldValue !== null && fieldValue !== undefined) {
                        return resolve();
                    }

                    if (field.indexOf("_") === 0) {
                        var funcName = this.getFuncNameFromField(field);

                        if (!doc[funcName]) {
                            var err = new Error("Projection function " + funcName + " missing on model " + doc.constructor.modelName);
                            this.log.error(err);
                            return reject(err);
                        }

                        return doc[funcName](req).then((val) => {
                            if (val !== null && val !== undefined) {
                                fieldValue = val;
                            }
                            return resolve();
                        });
                    } else {
                        var value = doc.get(field);
                        if (value !== null && value !== undefined) {
                            fieldValue = value;
                        }
                        return resolve();
                    }
                });
            }).then(() => {
                resolve(fieldValue);
            }, reject);
        });
    }


    /**
     *
     * @param {string} config
     * @returns {Array}
     */
    getFieldArrayFromProjectionConfig(config) {
        if (!config) {
            return [];
        }

        return config.split("=>").map((v) => {
            return v.trim();
        });
    }

    /**
     *
     * @param {string} field
     * @returns {string}
     */
    getFuncNameFromField(field) {
        field = field.substr(1);
        return "get" + Tools.capitalizeFirstLetter(field);
    }
}