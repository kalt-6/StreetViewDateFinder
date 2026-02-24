export const SingleImageSearch = {
  "nested": {
    "SingleImageSearchRequest": {
      "oneofs": { "query": { "oneof": [ "location", "gpsFeatureDescriptionInternal", "feature" ] } },
      "fields": {
        "context": { "type": "RequestContext", "id": 1 },
        "location": { "type": "PhotoByLatLngQuery", "id": 2 },
        "gpsFeatureDescriptionInternal": { "type": "FeatureDescription", "id": 7 },
        "feature": { "type": "PhotoByFeatureQuery", "id": 8 },
        "queryOptions": { "type": "PhotoQueryOptions", "id": 3 },
        "responseSpecification": { "type": "MetadataResponseSpecification", "id": 4 },
        "imageKey": { "type": "ImageKey", "id": 5 },
        "pixelSpecification": { "type": "PixelResponseSpecification", "id": 6 },
        "referrerUrl": { "type": "string", "id": 9 }
      }
    },
    "SingleImageSearchResponse": {
      "fields": {
        "status": { "type": "ResponseStatus", "id": 1 },
        "metadata": { "type": "ImageMetadata", "id": 2 },
        "unknown": { "type": "UnknownSingleImageSearchResponseComponent", "id": 3 }
      }
    },
    "ClientCapabilities": {
      "fields": {
        "renderStrategy": { "rule": "repeated", "type": "RenderStrategy", "id": 1 },
        "allow_3pPhoto": { "type": "bool", "id": 2 },
        "maxDimension": { "type": "ImageSize", "id": 3 },
        "allowCrawledPhoto": { "type": "bool", "id": 4 },
        "allowPhotoSequence": { "type": "bool", "id": 5 }
      }
    },
    "Date": {
      "fields": {
        "year": { "type": "int32", "id": 1 },
        "month": { "type": "int32", "id": 2 },
        "day": { "type": "int32", "id": 3 }
      }
    },
    "ImageDate": { "fields": { "date": { "type": "Date", "id": 8 } } },
    "ImageFormatRestrictions": { "values": { "UNKNOWN_FORMAT": 1, "OFFICIAL_FORMAT": 2 } },
    "ImageFrontendType": { "values": { "OFFICIAL": 2, "UNKNOWN": 3, "USER_UPLOADED": 10 } },
    "ImageKey": {
      "fields": { "frontend": { "type": "ImageFrontendType", "id": 1 }, "id": { "type": "string", "id": 2 } }
    },
    "ImageMetadata": {
      "fields": {
        "status": { "type": "ImageStatus", "id": 1 },
        "pano": { "type": "ImageKey", "id": 2 },
        "information": { "rule": "repeated", "type": "ImageInformation", "id": 6 },
        "date": { "type": "ImageDate", "id": 7 }
      }
    },
    "ImageInformation": {
      "fields": { "location": { "type": "PanoLocation", "id": 2 } }
    },
    "PanoLocation": {
      "fields": { "location": { "type": "LatLng", "id": 1 } }
    },
    "ImageSize": { "fields": { "height": { "type": "int32", "id": 1 }, "width": { "type": "int32", "id": 2 } } },
    "ImageStatus": { "fields": { "code": { "type": "StatusCode", "id": 1 } }, "nested": { "StatusCode": { "values": { "OK": 1 } } } },
    "LatLng": { "fields": { "lat": { "type": "double", "id": 3 }, "lng": { "type": "double", "id": 4 }, "planet": { "type": "Planet", "id": 5 } }, "nested": { "Planet": { "values": { "EARTH": 1 } } } },
    "MetadataResponseSpecification": {
      "fields": {
        "component": { "rule": "repeated", "type": "ResponseComponent", "id": 1 },
        "clientCapabilities": { "type": "ClientCapabilities", "id": 9 }
      }
    },
    "PhotoByLatLngQuery": {
      "fields": {
        "center": { "type": "LatLng", "id": 1 },
        "radius": { "type": "double", "id": 2 }
      }
    },
    "PhotoFilterOptions": {
      "fields": {
        "formatRestrictions": { "type": "ImageFormatRestrictions", "id": 1 },
        "photoAge": { "type": "TimestampRange", "id": 11 }
      }
    },
    "PhotoQueryOptions": {
      "fields": {
        "filterOptions": { "type": "PhotoFilterOptions", "id": 1 },
        "rankingOptions": { "type": "RankingOptions", "id": 9 },
        "clientCapabilities": { "type": "ClientCapabilities", "id": 11 }
      }
    },
    "RankingOptions": { "fields": { "rankingStrategy": { "type": "RankingStrategy", "id": 1 } } },
    "RankingStrategy": { "values": { "BEST": 1, "CLOSEST": 2 } },
    "RenderStrategy": {
      "fields": {
        "frontend": { "type": "ImageFrontendType", "id": 1 },
        "tiled": { "type": "bool", "id": 2 },
        "imageFormat": { "type": "ImageFormat", "id": 3 }
      },
      "nested": { "ImageFormat": { "values": { "OFFICIAL_FORMAT": 2 } } }
    },
    "ResponseComponent": { "values": { "INCLUDE_DESCRIPTION": 2, "INCLUDE_LINKED_PANORAMAS": 6 } },
    "ResponseStatus": {
      "fields": {
        "code": { "type": "StatusCode", "id": 1 },
        "errorMessage": { "type": "string", "id": 3 }
      },
      "nested": { "StatusCode": { "values": { "OK": 0, "UNKNOWN": 3, "NO_RESULTS": 5 } } }
    },
    "RequestContext": { "fields": { "productId": { "type": "string", "id": 1 } } },
    "TimestampRange": { "fields": { "startSeconds": { "type": "double", "id": 1 }, "endSeconds": { "type": "double", "id": 2 } } },
    "UnknownSingleImageSearchResponseComponent": { "fields": { "unknownNumber": { "type": "float", "id": 1 } } }
  }
};
