<template>
    <div id="map"></div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import maplibregl from 'maplibre-gl';

export default defineComponent({
    name: 'MapApp',

    data() {
        return {
            MAP_API_KEY: '7L48rPQ6rgJHYZon4zmZ'
        };
    },

    mounted() {
        const map = new maplibregl.Map({
            container: 'map',
            style: `https://api.maptiler.com/maps/streets/style.json?key=${this.MAP_API_KEY}`,
            zoom: 3
        });


        map.on('style.load', () => {
            map.setProjection({
                type: 'globe',
            });
        });

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
</style>