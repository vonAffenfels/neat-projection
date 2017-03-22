"use strict";

// @IMPORTS
const Application = require("neat-base").Application;
const Module = require("neat-base").Module;
const Tools = require("neat-base").Tools;
const fs = require("fs");
const Promise = require("bluebird");

module.exports = class Projection extends Module {

    static defaultConfig() {
        return {
            dbModuleName: "database",
            publish: null,
            projections: {
                user: {
                    list: {
                        name: "username",
                    }
                }
            },
            permissions: {
                public: [
                    "user.list"
                ]
            }
        }
    }

    /**
     *
     */
    init() {
        return new Promise((resolve, reject) => {
            this.log.debug("Initializing...");

            // only register the models if needed, pointless otherwise...
            if (this.config.publish) {
                Application.modules[this.config.dbModuleName].registerModel("published", require("./models/published.js"));
            }

            this.initMongoose();
            resolve(this);
        });
    }

    /**
     *
     */
    initMongoose() {
        let self = this;
        let proto = Application.modules[this.config.dbModuleName].mongoose.Query.prototype;
        proto._neatProjectionSavedExec = proto.exec;
        proto.projection = function (pkg, req) {
            this._neatProjectionPackage = pkg;
            this._neatProjectionRequest = req;
            return this;
        };

        let protoModel = Application.modules[this.config.dbModuleName].mongoose.Model.prototype;
        protoModel.project = function (pkg, req) {
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
     * @param {Document} user
     * @param {string} modelName
     * @param {string} projection
     */
    hasPermission(user, modelName, projection) {
        let projectionName = modelName + "." + projection;
        let permissionName = "projection." + projectionName;

        // check if the projection even exists
        if (!this.config.projections[modelName]) {
            this.log.warn("missing model definition for projection " + projectionName);
            return false;
        } else if (!this.config.projections[modelName][projection]) {
            this.log.warn("missing projection " + projectionName);
            return false;
        }

        // check if its public
        if (this.config.permissions.public.indexOf(projectionName) !== -1) {
            return true;
        }

        // so not public, do we have a user ?
        if (!user) {
            return false;
        }

        // ok does the user have the permission to use this projection
        if (user.hasPermission(permissionName)) {
            this.log.warn("User " + user.username + " tried to use projection " + permissionName + " but didn't have permission");
            return false;
        }

        // always default to no permissions
        return false;
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

        let modelName = doc.constructor.modelName;

        if (!this.config.projections[modelName]) {
            return Promise.reject(new Error("No projection configured for model " + modelName));
        }

        if (!this.config.projections[modelName][pkg]) {
            return Promise.reject(new Error("No projection configured for model " + modelName + " and package " + pkg));
        }

        let conf = this.config.projections[modelName][pkg];
        conf["_id"] = "_id";

        return new Promise((resolve, reject) => {
            let result = {};

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
            let fields = this.getFieldArrayFromProjectionConfig(config);
            let fieldValue = null;

            return Promise.mapSeries(fields, (field) => {
                return new Promise((resolve, reject) => {
                    // if a value already has been found, skip everything else
                    if (fieldValue !== null && fieldValue !== undefined) {
                        return resolve();
                    }

                    if (field.indexOf("_") === 0 && !doc.schema.path(field)) {
                        let funcName = this.getFuncNameFromField(field);

                        if (!doc[funcName]) {
                            let err = new Error("Projection function " + funcName + " missing on model " + doc.constructor.modelName);
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
                        let value = doc.get(field);
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

    modifySchema(modelName, schema) {
        // dont add publish hooks if unnecessary
        if (!this.config.publish || !this.config.publish[modelName]) {
            return;
        }

        let moduleSelf = this;

        schema.post("save", function () {
            moduleSelf.publish(modelName, this.get("_id"));
        });

        schema.post("remove", function () {
            moduleSelf.depublish(modelName, this.get("_id"));
        });
    }

    /**
     *
     * @param modelName
     * @param _id
     * @param projection
     */
    depublish(modelName, _id, projection) {
        this.log.debug("Depublishing " + modelName + " with id " + _id);
        let publishedModel = Application.modules[this.config.dbModuleName].getModel("published");
        let query = {
            _id: _id,
            model: modelName
        };

        // if a condition failed, this function will be given the projection, so only include it if present
        if (projection) {
            query.projection = projection;
        }

        return publishedModel.remove(query);
    }

    /**
     *
     * @param modelName
     * @param _id
     * @returns {Promise.<T>}
     */
    publish(modelName, _id) {
        // dont do anything if it doesnt exist
        if (!this.config.publish || !this.config.publish[modelName]) {
            return Promise.resolve();
        }

        let publishConfig = this.config.publish[modelName];
        let publishedModel = Application.modules[this.config.dbModuleName].getModel("published");
        let model = Application.modules[this.config.dbModuleName].getModel(modelName);

        // get the original doc
        return model.findOne({
            _id: _id
        }).then((doc) => {
            return Promise.map(Object.keys(publishConfig), (projection) => {

                // Check if there are any conditions to this publication, if so check them
                let shouldPublish = true;
                if (publishConfig[projection] !== true && publishConfig[projection].condition) {
                    for (let path in publishConfig[projection].condition) {
                        let value = publishConfig[projection].condition[path];
                        let docValue = doc.get(path);

                        this.log.debug("Checking publish condition on " + path + " with required value " + value + " document value is " + docValue);
                        if (docValue != value) {
                            this.log.debug("Condition didnt pass, dont publish");
                            shouldPublish = false;
                        }
                    }
                }

                // Conditions failed, so depublish this document in case it was published earlier
                if (!shouldPublish) {
                    return this.depublish(modelName, _id, projection);
                }

                // get the projection
                return doc.project(projection).then((result) => {
                    // upsert the final published document
                    return publishedModel.update({
                        model: modelName,
                        projection: projection,
                        refId: result._id
                    }, {
                        model: modelName,
                        projection: projection,
                        data: result,
                        refId: result._id,
                        _updatedAt: new Date()
                    }, {
                        upsert: true
                    }).then(() => {
                        this.log.debug("Published " + result._id + " for " + projection);
                    }, (err) => {
                        this.log.warn("Error while publishing");
                        this.log.warn(err);
                    });
                });
            });
        });
    }
}