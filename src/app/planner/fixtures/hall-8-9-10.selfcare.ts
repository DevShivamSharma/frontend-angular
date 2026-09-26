import type { SelfcareEnvelope, SelfcareLayoutRow } from '../geometry/selfcare-layout';

/**
 * The live SelfCare response for Hall 8-9-10, captured from
 * `GET /stall/itpo/api/v1/event-hall-layouts-data/103` (event
 * `60fb0781-5145-450d-9a24-a71eb2174ef1`), verbatim.
 *
 * WHY IT IS CHECKED IN
 * --------------------
 * Nothing in the planner fetches from SelfCare yet, so without this the hall list falls back to
 * a blank 40 x 40 room and none of the imported geometry is ever visible. Shipping the real
 * response means the planner opens on the real hall — its outline, gate labels, amenity icons
 * and north arrow — and can be compared against the SelfCare portal side by side.
 *
 * It is also the reference case for the importer: this exact payload is what
 * `selfcare-layout.spec.ts` asserts against.
 *
 * Note what it does NOT contain: not one `red` or `saddlebrown` rectangle. The official plan
 * marks no compulsory passage and no no-construction zone for this hall, so the planner must
 * draw none. Any passage band on Hall 8-9-10 comes from the ITPO rule engine
 * (`placement-rules.ts`), never from SelfCare.
 *
 * Replace this with a live fetch once the SelfCare client is wired; the shape is identical, so
 * `importSelfcareResponse()` consumes either without change.
 */
export const HALL_8_9_10_SELFCARE: SelfcareEnvelope<SelfcareLayoutRow[]> = {
    "header": {
      "code": 200,
      "error": false,
      "success": true,
      "msg": "Success"
    },
    "data": [
      {
        "hallId": 63,
        "name": "Hall 8-9-10",
        "length": 133,
        "breadth": 43,
        "layout_data": {
          "shape": "non-circular",
          "stallWidth": 1,
          "stallHeight": 1,
          "nonClickableAreas": [
            {
              "x": 18,
              "y": 0,
              "width": 54,
              "height": 3,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 57,
              "y": 3,
              "width": 15,
              "height": 16,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 0,
              "y": 0,
              "width": 2,
              "height": 44,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 1,
              "y": 0,
              "width": 18,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 1,
              "y": 37,
              "width": 17,
              "height": 8,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 18,
              "y": 42,
              "width": 54,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 57,
              "y": 37,
              "width": 15,
              "height": 5,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 1.5,
              "y": 0.5,
              "width": 0.5,
              "height": 37,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 2,
              "y": 0.5,
              "width": 16.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 2,
              "y": 37,
              "width": 16,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 17.5,
              "y": 37.5,
              "width": 0.5,
              "height": 5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 18,
              "y": 42,
              "width": 39.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 18,
              "y": 1,
              "width": 0.5,
              "height": 2,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 18.5,
              "y": 2.5,
              "width": 39,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 57,
              "y": 3,
              "width": 0.5,
              "height": 16,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 57.5,
              "y": 18.5,
              "width": 14.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 57,
              "y": 37,
              "width": 15,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 57,
              "y": 37.5,
              "width": 0.5,
              "height": 4.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 71,
              "y": 42,
              "width": 62,
              "height": 2,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 71,
              "y": 0,
              "width": 62,
              "height": 13.5,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 106.5,
              "y": 11.5,
              "width": 26.5,
              "height": 13.5,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 106.5,
              "y": 25,
              "width": 14,
              "height": 5.5,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 131.5,
              "y": 25,
              "width": 1.5,
              "height": 17,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 71.5,
              "y": 37,
              "width": 0.5,
              "height": 5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 71.5,
              "y": 42,
              "width": 49.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 71.5,
              "y": 14,
              "width": 0.5,
              "height": 4.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 71.5,
              "y": 13.5,
              "width": 34.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 106,
              "y": 13.5,
              "width": 0.5,
              "height": 17.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 106.5,
              "y": 30.5,
              "width": 14.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 126.5,
              "y": 24.5,
              "width": 5,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 127.5,
              "y": 25.5,
              "width": 4,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 128.5,
              "y": 26.5,
              "width": 3,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 129.5,
              "y": 27.5,
              "width": 2,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 130.5,
              "y": 28.5,
              "width": 1,
              "height": 1,
              "fillColor": "#ffffff",
              "strokeColor": "#ffffff"
            },
            {
              "x": 120.5,
              "y": 25,
              "width": 5.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 120.5,
              "y": 25.5,
              "width": 0.5,
              "height": 5.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 121,
              "y": 42,
              "width": 10,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 131,
              "y": 29.5,
              "width": 0.5,
              "height": 13,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 126,
              "y": 25,
              "width": 0.5,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 126,
              "y": 25.5,
              "width": 1,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 127,
              "y": 25.5,
              "width": 0.5,
              "height": 1,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 127,
              "y": 26.5,
              "width": 1,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 128,
              "y": 26.5,
              "width": 0.5,
              "height": 1,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 128,
              "y": 27.5,
              "width": 1,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 129,
              "y": 27.5,
              "width": 0.5,
              "height": 1,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 129,
              "y": 28.5,
              "width": 1,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 130,
              "y": 28.5,
              "width": 0.5,
              "height": 1,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            },
            {
              "x": 130,
              "y": 29.5,
              "width": 1,
              "height": 0.5,
              "fillColor": "#742371",
              "strokeColor": "#742371"
            }
          ]
        },
        "legends": [
          {
            "label": "Compulsory passage for entry/exit/services",
            "colorCode": "red"
          },
          {
            "label": "NC - No Construction Zone",
            "colorCode": "saddlebrown"
          },
          {
            "label": "Entry or exit gates",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\">E:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "Service Gates",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\">S:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "Toilet",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\">T:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "First two digits indicates Hall no.",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\"><span class=\"text-decoration-underline\">09</span>01:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "Second two digits indicates Toilet no. or Hose reel no. or entry gate no. or service gate no.",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\">09<span class=\"text-decoration-underline\">01</span>:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "First two digits indicates Hall no.",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\"><span class=\"text-decoration-underline\">10</span>01:</p>",
            "visibleInBookMode": false
          },
          {
            "label": "Second two digits indicates Toilet no. or Hose reel no. or entry gate no. or service gate no.",
            "htmlContent": "<p class=\"color-dark fw-500 mb-0\">10<span class=\"text-decoration-underline\">01</span>:</p>",
            "visibleInBookMode": false
          }
        ],
        "helper_text": [
          {
            "image": [
              {
                "url": "assets/images/toilet-male.svg",
                "label": "Toilet (Male)"
              },
              {
                "url": "assets/images/toilet-female.svg",
                "label": "Toilet (Female)"
              },
              {
                "url": "assets/images/stairs.svg",
                "label": "Stairs/Elevators"
              }
            ],
            "positionX": 200,
            "positionY": -120
          },
          {
            "image": [
              {
                "url": "assets/images/toilet-male.svg",
                "label": "Toilet (Male)"
              },
              {
                "url": "assets/images/toilet-female.svg",
                "label": "Toilet (Female)"
              },
              {
                "url": "assets/images/stairs.svg",
                "label": "Stairs/Elevators"
              }
            ],
            "positionX": 2210,
            "positionY": 350
          },
          {
            "image": [
              {
                "url": "assets/images/entry-up.svg",
                "label": "Entry"
              }
            ],
            "positionX": 1255,
            "positionY": 855
          }
        ],
        "exit_labels": [
          {
            "text": "S1001",
            "positionX": 620,
            "positionY": 20
          },
          {
            "text": "E1001",
            "positionX": 1155,
            "positionY": 750
          },
          {
            "text": "FOYER C",
            "positionX": 170,
            "positionY": -20
          },
          {
            "text": "FOYER B",
            "positionX": 1270,
            "positionY": 340
          },
          {
            "text": "TH9-1/8",
            "positionX": 2410,
            "positionY": 465
          },
          {
            "text": "FOYER A",
            "positionX": 2230,
            "positionY": 580
          },
          {
            "text": "S0901",
            "positionX": 2042,
            "positionY": 238
          },
          {
            "text": "HALL 8",
            "positionX": 2500,
            "positionY": 860
          },
          {
            "text": "HALL 9",
            "positionX": 1760,
            "positionY": 860
          },
          {
            "text": "HALL 10",
            "positionX": 720,
            "positionY": 860
          }
        ],
        "direction": {
          "image": {
            "url": "assets/images/direction.svg",
            "width": 100,
            "height": 100,
            "rotation": -90,
            "positionX": 10,
            "positionY": 10
          },
          "label": {
            "text": "N",
            "positionX": -28,
            "positionY": -35
          },
          "positionX": 2600,
          "positionY": 950
        },
        "default_stalls": null
      }
    ]
  };
