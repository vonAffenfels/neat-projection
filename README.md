# neat-projection


Adds projection to the neat framework, specially to the neat-api module.

This means the module will allow your api endpoints to deliver data according to a schema your define, not the the actual data in the database.

### FEATURES

#### Projection

##### Example

You have this document in your database (in a model named test)


```
{
    "_id" : "64ej67k47k46k6k4e67kek67",
    "name" : "test",
    "displayname": "I am a test",
    "locations": [
        "Germany",
        "USA",
        "Canada"
    ]
}
```

In an app / webapp you want to not have the data in more easily displayed version.
So you define the following in your projection.json config file.

```
    {
        projections: {
            test: {                                     // this is your model
                list: {                                 // this is the projection name 
                    name: "displayname => name",        // this means use the field name only in case displayname is an empty value
                    locations: "_prettyLocations"       // the _ signals to the framework you want to call a document function. 
                                                        // It will look for a function getPrettyLocations on your model, this function is required to return a Promise.
                }
            }
        }
    }
```

##### Usage

Just add
```
    projection: "list"     // list is the name of the projection we defined above
```
as a regular (json)body parameter to any find/findOne call to the neat-api module
```
    [POST] /api/test/find
```

#### Publish \*NEW\*

You can now automatically generate your projections to a completely seperate collection in the database, this is used for performance reasons

##### Example usecase
You have a few thousand highly complex documents in a collection that have a lot of references to other collections.

An app wants to pull big chunks of this data for offline storage and wants to do queries for "new" content this would be a new api route
(from and to are optional)
```
GET /api/[model]/changes/[type=json]/[projection name]/[Datestring from]/[Datestring to]
```
This is GET by design so for example a complete export (no from/to) could be cached via nginx

This will pull a LOT of data from the published database and can be used for updates in offline enabled apps of sorts


##### How it works

in your projection.json config file add

```
"publish": {
    "MODEL": {
        "PROJECTION": true // true will just publish them on every save
        "PROJECTION2": {
            "condition": {                  // a simple key value pair of mongodb paths and values, if the condition fails, the document wont be "published" (and ofc depublished if it was published before)
                "PATH.IS.Enabled": true 
            }
        }
    }
}
```

Now on every save of a document of the given model one or more projections will be put into the "published" model collection and can be used from there.














### FAQ

* Yes function calls can be anywhere in the fallback chain (defined by =>)
* No you cant change the fallback chain syntax. Why? Because i think it works well this way...


### ROADMAP

* Use published data as "cache" for projections
* Add populate ("__populate": []?) to the projections themselves, so we dont have to take care of it in the frontend (no need to add it to the requests, would be much safer that way)