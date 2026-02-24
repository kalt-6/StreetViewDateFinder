// Export the massive schema so we don't clog up our main logic file
export const SingleImageSearch = {
  "nested": {
    "SingleImageSearchRequest": {
      "oneofs": { "query": { "oneof": [ "location", "gpsFeatureDescriptionInternal", "feature" ] } },
      "fields": {
        "context": { "type": "RequestContext", "id": 1 },
        "location": { "type": "PhotoByLatLngQuery", "id": 2 },
        // ... (PASTE THE REST OF THE EXACT SCHEMA DICTIONARY HERE) ...
        "UnknownSingleImageSearchResponseComponent": { "fields": { "unknownNumber": { "type": "float", "id": 1 } } }
      }
    }
  }
};