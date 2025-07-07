<template>
    <div id="map"></div>
    <div id="controls" class="controls">
      <button @click="playFlight">Play</button>
      <button @click="pauseFlight">Pause</button>
      <button @click="restartFlight">Restart</button>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import maplibregl, { Map, type LngLatLike, type CustomLayerInterface } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as turf from '@turf/turf';
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
                altitude: 12,
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
        // Define the route as a Turf.js LineString
        const route: turf.helpers.Feature<turf.helpers.LineString> = turf.lineString([
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
        let modelTransform = {
            translateX: modelAsMercatorCoordinate.x,
            translateY: modelAsMercatorCoordinate.y,
            translateZ: modelAsMercatorCoordinate.z,
            rotateX: modelRotate[0],
            rotateY: modelRotate[1],
            rotateZ: modelRotate[2],
            scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
        };

        // Store reference to component
        const that = this;

        // Configuration of the custom layer
        const customLayer: CustomLayerInterface = {
            id: '3d-model',
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.clock = new THREE.Clock();
                that.flightStartTime = null;
                this.flightDuration = 15; // seconds for full route
                this.helicopter = null;
                this.helicopterGroup = null;
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();
                this.route = route;
                this.routeLength = routeLength;

                // Add lighting
                const directionalLight = new THREE.DirectionalLight(0xffffff);
                directionalLight.position.set(0, -70, 100).normalize();
                this.scene.add(directionalLight);

                const directionalLight2 = new THREE.DirectionalLight(0xffffff);
                directionalLight2.position.set(0, 70, 100).normalize();
                this.scene.add(directionalLight2);

                this.mixer = null;

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
                        gltf.scene.rotation.copy(that.helicopterConfig.rotation);

                        // Create group for helicopter
                        this.helicopterGroup = new THREE.Group();
                        this.helicopter = gltf.scene;
                        this.helicopterGroup.add(this.helicopter);
                        this.scene.add(this.helicopterGroup);
                        window.helicopterGroup = this.helicopterGroup;
                        window.helicopter = this.helicopter;

                        // Setup animation mixer
                        if (gltf.animations && gltf.animations.length > 0) {
                            this.mixer = new THREE.AnimationMixer(gltf.scene);
                            gltf.animations.forEach((clip) => {
                                this.mixer.clipAction(clip).play();
                            });
                        }

                        // Start flight animation
                        that.flightStartTime = performance.now();
                    }
                );

                this.map = map;
                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;
            },
            render: function (gl, args) {
                console.log(that.shouldRender)
                if (that.shouldRender) {
                    const now = performance.now();
                    const elapsed = (now - that.flightStartTime) / 1000; // in seconds

                    if (this.mixer) {
                        this.mixer.setTime(elapsed % this.flightDuration); // loop within animation duration
                    }


                    // Fly along the route
                    if (this.helicopterGroup && that.flightStartTime !== null) {
                        const now = performance.now();
                        const elapsed = (now - that.flightStartTime) / 1000; // Convert to seconds
                        const progress = (elapsed % this.flightDuration) / this.flightDuration; // Loop animation

                        
                        if (progress < 0.51) {
                            modelAltitude += 0.1;
                        } else {
                            modelAltitude -= 0.1;
                        }

                        if (progress > 0.99) {
                            that.shouldRender = false;
                        }
                        

                        // Calculate distance along route
                        const distance = progress * this.routeLength;

                        // Get position along route using Turf.js
                        const pointOnLine = turf.along(this.route, distance, { units: 'meters' });
                        const pointCoord = pointOnLine.geometry.coordinates;

                        const scale = modelAsMercatorCoordinate.meterInMercatorCoordinateUnits();



                        // Calculate direction for rotation
                        const nextDistance = (distance + 10) % this.routeLength; // Look 5 meters ahead
                        const nextPoint = turf.along(this.route, nextDistance, { units: 'meters' });
                        const bearing = turf.bearing(pointOnLine, nextPoint);
                        const yaw = (-bearing * Math.PI);




                        modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
                            pointCoord,
                            modelAltitude
                        );

                        // Transformation parameters
                        modelTransform = {
                            translateX: modelAsMercatorCoordinate.x,
                            translateY: modelAsMercatorCoordinate.y,
                            translateZ: modelAsMercatorCoordinate.z,
                            rotateX: modelRotate[0],
                            rotateY: yaw,
                            rotateZ: modelRotate[2],
                            scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
                        };

                        // this.map.flyTo({
                        //     center: pointCoord,
                        //     bearing: yaw, // helicopter heading
                        //     pitch: 360,
                        //     duration: 1000 // very short duration for smooth following
                        // });
                        
                        this.map.setCenter(pointCoord);
                        this.map.setBearing(yaw * (180 / Math.PI)); // convert to degrees
                        // this.map.jumpTo({center: pointCoord, elevation: modelAltitude*10000});

                    }


                    
                    
                }
                // Apply model transformations
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

                const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
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

                this.camera.projectionMatrix = m.multiply(l);
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
                this.map.triggerRepaint();
            },
            bearing: function (startLat, startLng, destLat, destLng) {
                startLat = this.toRadians(startLat);
                startLng = this.toRadians(startLng);
                destLat = this.toRadians(destLat);
                destLng = this.toRadians(destLng);
                let y = Math.sin(destLng - startLng) * Math.cos(destLat);
                let x = Math.cos(startLat) * Math.sin(destLat) -
                    Math.sin(startLat) * Math.cos(destLat) * Math.cos(destLng - startLng);
                let brng = Math.atan2(y, x);
                brng = this.toDegrees(brng);
                return (brng + 360) % 360;
            },
            toRadians: function (degrees) {
                return degrees * Math.PI / 180;
            },
            // Converts from radians to degrees.
            toDegrees: function (radians) {
                return radians * 180 / Math.PI;
            },
            mercatorToNormalized: function (longitude, latitude) {
                const PI = Math.PI;
                const normalizedLongitude = longitude / 180; // Scale longitude to -1 to 1 range
                const normalizedLatitude = Math.log(Math.tan((PI / 4) + (latitude * PI / 360))) / PI; // Mercator projection for latitude

                return {
                    x: normalizedLongitude,
                    y: normalizedLatitude
                };
            },
            normalizedToThreeJS: function (normalizedX, normalizedY, sceneWidth, sceneHeight) {
                // Assuming the center of your Three.js scene is (0,0) for the map
                const threeJS_X = normalizedX * (sceneWidth / 2);
                const threeJS_Y = normalizedY * (sceneHeight / 2); // Adjust sign if y-axis is inverted in your Three.js setup

                return {
                    x: threeJS_X,
                    y: threeJS_Y
                };
            }
        };

        map.on('style.load', () => {
            map.addLayer(customLayer);
        });

        window.customLayer = customLayer;
    },
    methods: {
        playFlight() {
            // if (!this.shouldRender) {
            //     this.shouldRender = true;
            //     const customLayer = (window as any).customLayer;
            //     if (customLayer && customLayer.flightStartTime === null) {
            //         // Restart from beginning if not already started
            //         customLayer.flightStartTime = performance.now();
            //     }
            //     this.map?.triggerRepaint();
            // }
            this.shouldRender = true;
            this.flightStartTime = performance.now();
        },
        pauseFlight() {
            this.shouldRender = false;
        },
        restartFlight() {
            const customLayer = (window as any).customLayer;
            if (customLayer) {
                customLayer.flightStartTime = performance.now();
                this.shouldRender = true;
                this.map?.triggerRepaint();
            }
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