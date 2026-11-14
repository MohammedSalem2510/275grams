'use strict';
// Pro "field instrument" configuration, read by app.js through two hooks.
// Remove this file's <script> tag to get the original behaviour back.

// Fixed across filters so equal rates always have the same colour.
window.CHIRP_SCALE_MAX = 20;

// Desaturated basemap: colour on the page belongs to data only.
window.CHIRP_MAP_OPTIONS = {
  mapTypeId: 'roadmap',
  scaleControl: true,
  styles: [
    {elementType: 'geometry', stylers: [{color: '#eef0ec'}]},
    {elementType: 'labels.icon', stylers: [{visibility: 'off'}]},
    {elementType: 'labels.text.fill', stylers: [{color: '#6b716b'}]},
    {elementType: 'labels.text.stroke', stylers: [{color: '#f6f7f4'}]},
    {featureType: 'administrative', elementType: 'geometry', stylers: [{visibility: 'off'}]},
    {featureType: 'poi', stylers: [{visibility: 'off'}]},
    {featureType: 'poi.park', elementType: 'geometry', stylers: [{visibility: 'on'}, {color: '#dfe6d9'}]},
    {featureType: 'landscape.natural', elementType: 'geometry', stylers: [{color: '#e7ebe2'}]},
    {featureType: 'road', elementType: 'geometry', stylers: [{color: '#ffffff'}]},
    {featureType: 'road', elementType: 'labels', stylers: [{visibility: 'off'}]},
    {featureType: 'transit', stylers: [{visibility: 'off'}]},
    {featureType: 'water', elementType: 'geometry', stylers: [{color: '#d4dde2'}]},
    {featureType: 'water', elementType: 'labels.text.fill', stylers: [{color: '#8a9aa2'}]},
  ],
};

function streetStyles() {
  const base = window.CHIRP_MAP_OPTIONS.styles;
  if (document.documentElement.dataset.appearance !== 'dark') return base;
  return [...base,
    {elementType:'geometry', stylers:[{color:'#22352c'}]},
    {featureType:'landscape.natural', elementType:'geometry', stylers:[{color:'#293b31'}]},
    {featureType:'poi.park', elementType:'geometry', stylers:[{color:'#254331'}]},
    {featureType:'road', elementType:'geometry', stylers:[{color:'#46574d'}]},
    {featureType:'water', elementType:'geometry', stylers:[{color:'#132b37'}]},
    {elementType:'labels.text.fill', stylers:[{color:'#bdcfc1'}]},
    {elementType:'labels.text.stroke', stylers:[{color:'#203028'}]},
    {featureType:'water', elementType:'labels.text.fill', stylers:[{color:'#a2bfcb'}]}
  ];
}
