# neat-projection


Adds projection to the neat framework, specially to the neat-api module.

This means the module will allow your api endpoints to deliver data according to a schema your define, not the the actual data in the database.

#### Example

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

#### Usage

Just add
```
    projection: "list"     // list is the name of the projection we defined above
```
as a regular (json)body parameter to any find/findOne call to the neat-api module
```
    [POST] /api/test/find
```

#### FAQ

* Yes function calls can be anywhere in the fallback chain (defined by =>)
* No you cant change the fallback chain syntax. Why? Because i think it works well this way...