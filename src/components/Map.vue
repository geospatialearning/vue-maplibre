<template>
    <div id="map"></div>
    <div id="controls" class="controls">
      <button @click="playFlight">Play</button>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import maplibregl, { Map, type LngLatLike, type CustomLayerInterface } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as turf from '@turf/turf';
import type * as GeoJSON from 'geojson';
import helicopterModelUrl from '@/assets/3d_models/low_poly_helicopter.glb?url';

export default defineComponent({
    name: 'MapApp',

    data() {
        return {
            containerId: 'map-container',
            map: null as Map | null,

            MAP_CENTER: [-81.4004, 28.5396] as LngLatLike,
            MAP_API_KEY: '7L48rPQ6rgJHYZon4zmZ',

            helicopterConfig: {
                id: 'helicopter',
                url: helicopterModelUrl,
                scale: 2,
                rotation: 0,
                altitude: 10,
            },
            shouldRender: false,
            flightStartTime: 0
        };
    },

    mounted() {
        const map = new maplibregl.Map({
            container: 'map',
            style: `https://api.maptiler.com/maps/streets/style.json?key=${this.MAP_API_KEY}`,
            zoom: 17,
            center: this.MAP_CENTER,
            pitch: 60,
            canvasContextAttributes: { antialias: true }
        });
        const route: GeoJSON.Feature<GeoJSON.LineString> = turf.lineString([
            [-81.4004, 28.5396],
            [-81.4055, 28.541425]
        ]);

        // Calculate route length in meters
        const routeLength = turf.length(route, { units: 'meters' });

        map.on('style.load', () => {
            map.setProjection({
                type: 'globe',
            });

            // Add the route to the map for visualization
            map.addSource('route', {
                type: 'geojson',
                data: route,
            });
            map.addLayer({
                id: 'route-layer',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round',
                },
                paint: {
                    'line-color': '#007cbf',
                    'line-width': 5,
                    'line-opacity': 0.75,
                },
            });
        });

        // Parameters to ensure the model is georeferenced correctly
        const modelOrigin = this.MAP_CENTER;
        let modelAltitude = this.helicopterConfig.altitude;
        const modelRotate = [Math.PI / 2, 0, 0];

        let modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
            modelOrigin,
            modelAltitude
        );

        // Transformation parameters
        let modelTransform = this.modelTransform(modelAsMercatorCoordinate, modelRotate[0], modelRotate[1], modelRotate[2]);

        // Store reference to component
        const that = this;

        // Configuration of the custom layer
        const customLayer: CustomLayerInterface = {
            id: '3d-model',
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                const self = this as any; // Add this line

                that.flightStartTime = 0;
                self.flightDuration = 15; // seconds for full route
                self.helicopter = null;
                self.helicopterGroup = null;
                self.camera = new THREE.Camera();
                self.scene = new THREE.Scene();
                self.route = route;
                self.routeLength = routeLength;

                // Add lighting
                const directionalLight = new THREE.DirectionalLight(0xffffff);
                directionalLight.position.set(0, -70, 100).normalize();
                self.scene.add(directionalLight);

                const directionalLight2 = new THREE.DirectionalLight(0xffffff);
                directionalLight2.position.set(0, 70, 100).normalize();
                self.scene.add(directionalLight2);

                self.mixer = null;

                const loader = new GLTFLoader();
                loader.load(
                    that.helicopterConfig.url,
                    (gltf) => {
                        // Configure helicopter model
                        gltf.scene.scale.set(
                            that.helicopterConfig.scale,
                            that.helicopterConfig.scale,
                            that.helicopterConfig.scale
                        );
                        gltf.scene.rotation.y = that.helicopterConfig.rotation;

                        // Create group for helicopter
                        self.helicopterGroup = new THREE.Group();
                        self.helicopter = gltf.scene;
                        self.helicopterGroup.add(self.helicopter);
                        self.scene.add(self.helicopterGroup);

                        // Setup animation mixer
                        if (gltf.animations && gltf.animations.length > 0) {
                            self.mixer = new THREE.AnimationMixer(gltf.scene);
                            gltf.animations.forEach((clip) => {
                                self.mixer.clipAction(clip).play();
                            });
                        }

                        // Start flight animation
                        that.flightStartTime = performance.now();
                    }
                );

                self.map = map;
                self.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                self.renderer.autoClear = false;
            },
            render: function (gl, args) {
                const self = this as any; // Add this line
                if (that.shouldRender) {
                    const now = performance.now();
                    const elapsed = (now - that.flightStartTime) / 1000; // in seconds

                    if (self.mixer) {
                        self.mixer.setTime(elapsed % self.flightDuration); // loop within animation duration
                    }


                    // Fly along the route
                    if (self.helicopterGroup && that.flightStartTime !== null) {
                        const now = performance.now();
                        const elapsed = (now - that.flightStartTime) / 1000; // Convert to seconds
                        const progress = (elapsed % self.flightDuration) / self.flightDuration; // Loop animation

                        
                        if (progress < 0.51) {
                            modelAltitude += 0.1;
                        } else {
                            modelAltitude -= 0.1;
                        }

                        if (progress > 0.99) {
                            that.shouldRender = false;
                        }
                        

                        // Calculate distance along route
                        const distance = progress * self.routeLength;

                        // Get position along route using Turf.js
                        const pointOnLine = turf.along(self.route, distance, { units: 'meters' });
                        const pointCoord = pointOnLine.geometry.coordinates as [number, number];

                        const scale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();



                        // Calculate direction for rotation
                        const nextDistance = (distance + 10) % self.routeLength; // Look 5 meters ahead
                        const nextPoint = turf.along(self.route, nextDistance, { units: 'meters' });
                        const bearing = turf.bearing(pointOnLine, nextPoint);
                        const yaw = (-bearing * Math.PI);




                        modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
                            pointCoord,
                            modelAltitude
                        );

                        // Transformation parameters
                        modelTransform = that.modelTransform(modelAsMercatorCoordinate, modelRotate[0], yaw, modelRotate[2]);
                        
                        self.map.setCenter(pointCoord);
                        self.map.setBearing(yaw * (180 / Math.PI)); // convert to degrees

                    }                    
                    
                }

                // Apply model transformations                

                self.camera.projectionMatrix = that.modelTransformation(modelTransform, args.defaultProjectionData.mainMatrix);
                self.renderer.resetState();
                self.renderer.render(self.scene, self.camera);
                self.map.triggerRepaint();
            }
        };

        map.on('style.load', () => {
            map.addLayer(customLayer);
        });

    },
    methods: {
        playFlight() {
            this.shouldRender = true;
            this.flightStartTime = performance.now();
        },
        modelTransform(modelAsMercatorCoordinate: maplibregl.MercatorCoordinate, rotateX: number, rotateY: number, rotateZ: number) {
            return {
                translateX: modelAsMercatorCoordinate.x,
                translateY: modelAsMercatorCoordinate.y,
                translateZ: modelAsMercatorCoordinate.z,
                rotateX: rotateX,
                rotateY: rotateY,
                rotateZ: rotateZ,
                scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
            }
        },
        modelTransformation(modelTransform: { translateX: any; translateY: any; translateZ: any; rotateX: any; rotateY: any; rotateZ: any; scale: any; }, mainMatrix: ArrayLike<number>) {
            const rotationX = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(1, 0, 0),
                modelTransform.rotateX
            );
            const rotationY = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(0, 1, 0),
                modelTransform.rotateY
            );
            const rotationZ = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(0, 0, 1),
                modelTransform.rotateZ
            );

            const m = new THREE.Matrix4().fromArray(mainMatrix);
            const l = new THREE.Matrix4()
                .makeTranslation(
                    modelTransform.translateX,
                    modelTransform.translateY,
                    modelTransform.translateZ
                )
                .scale(
                    new THREE.Vector3(
                        modelTransform.scale,
                        -modelTransform.scale,
                        modelTransform.scale
                    )
                )
                .multiply(rotationX)
                .multiply(rotationY)
                .multiply(rotationZ);
            return m.multiply(l);
        }
    }
});
</script>

<style>
#map {
    width: 100%;
    height: 100vh;
    position: absolute;
    top: 0;
    left: 0;
}
.controls {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 999;
  background: rgba(255, 255, 255, 0.9);
  padding: 8px;
  border-radius: 6px;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.2);
}
.controls button {
  margin: 0 4px;
  padding: 6px 12px;
  font-weight: bold;
  cursor: pointer;
}
</style>