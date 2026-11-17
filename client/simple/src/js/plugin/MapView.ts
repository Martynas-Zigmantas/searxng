// SPDX-License-Identifier: AGPL-3.0-or-later

import "ol/ol.css";
import { Feature, Map as OlMap, View } from "ol";
import { GeoJSON } from "ol/format";
import { Point } from "ol/geom";
import { Vector as VectorLayer } from "ol/layer";
import { fromLonLat } from "ol/proj";
import { Vector as VectorSource } from "ol/source";
import { Circle, Fill, Stroke, Style } from "ol/style";
import { Plugin } from "../Plugin.ts";
import { alexandriaLayer, currentLook } from "../util/mapStyle.ts";

/**
 * MapView
 */
export default class MapView extends Plugin {
  private readonly map: HTMLElement;

  public constructor(map: HTMLElement) {
    super("mapView");

    this.map = map;
  }

  protected async run(): Promise<void> {
    const {
      leafletTarget: target,
      mapLon = "0",
      mapLat = "0",
      mapGeojson,
      mapVtiles = "/widgets/vtile/"
    } = this.map.dataset;

    const lon = Number.parseFloat(mapLon);
    const lat = Number.parseFloat(mapLat);
    const view = new View({ maxZoom: 16, enableRotation: false });
    const map = new OlMap({
      target: target,
      // map data through this instance (searx/places.py), drawn in the visitor's map look (util/mapStyle.ts)
      layers: [alexandriaLayer(mapVtiles)],
      view: view
    });

    try {
      const markerSource = new VectorSource({
        features: [
          new Feature({
            geometry: new Point(fromLonLat([lon, lat]))
          })
        ]
      });

      const markerLayer = new VectorLayer({
        source: markerSource,
        style: new Style({
          image: new Circle({
            radius: 6,
            fill: new Fill({ color: currentLook().pin })
          })
        })
      });

      map.addLayer(markerLayer);
    } catch (error) {
      console.error("Failed to create marker layer:", error);
    }

    if (mapGeojson) {
      try {
        const geoSource = new VectorSource({
          features: new GeoJSON().readFeatures(JSON.parse(mapGeojson), {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857"
          })
        });

        const geoLayer = new VectorLayer({
          source: geoSource,
          style: new Style({
            stroke: new Stroke({ color: "#3050ff", width: 2 }),
            fill: new Fill({ color: "#3050ff33" })
          })
        });

        map.addLayer(geoLayer);

        const geoSourceExtent = geoSource.getExtent();
        if (geoSourceExtent) {
          view.fit(geoSourceExtent, { padding: [20, 20, 20, 20] });
        }
      } catch (error) {
        console.error("Failed to create GeoJSON layer:", error);
      }
    }
  }

  protected async post(): Promise<void> {
    // noop
  }
}
