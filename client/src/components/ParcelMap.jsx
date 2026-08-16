import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import * as EsriLeaflet from 'esri-leaflet';
import 'leaflet/dist/leaflet.css';
import { Alert, Box, Chip, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material';
import env from '../config/env.js';
import api from '../api/client.js';

/**
 * The map used across all three modules.
 *
 * It never talks to a GIS service directly. Geometry comes from the LAMS API,
 * which sits in front of whichever provider is configured — the local sample
 * file today, the District's ArcGIS feature service when GIS_PROVIDER is
 * switched over. Basemap tiles, layers, centre and zoom all come from the
 * environment, so pointing this at the District's own basemap is configuration.
 *
 * When VITE_MAP_PROVIDER is "arcgis" the overlay is drawn straight from the
 * feature service via esri-leaflet; otherwise the same shapes arrive as GeoJSON
 * from the API. Both paths render through the same layer code below.
 */
export default function ParcelMap({
  parcelId,
  parcelIds,
  height = 320,
  showLayerSwitcher = true,
  onFeatureClick,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);

  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(env.map.layers));

  const query = useMemo(() => {
    if (parcelId) return `/gis/parcels/${parcelId}/geometry`;
    if (parcelIds?.length) return `/gis/features?parcelIds=${parcelIds.join(',')}`;
    return '/gis/features';
  }, [parcelId, parcelIds]);

  /* ---- create the map once ---- */
  useEffect(() => {
    if (!env.features.map || mapRef.current || !containerRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: env.map.defaultCenter,
      zoom: env.map.defaultZoom,
      scrollWheelZoom: false,
    });

    L.tileLayer(env.map.basemapUrl, {
      attribution: env.map.basemapAttribution,
      maxZoom: env.map.maxZoom,
    }).addTo(map);

    // Live ArcGIS service: draw its features directly through esri-leaflet.
    if (env.map.provider === 'arcgis' && env.map.featureServiceUrl) {
      EsriLeaflet.featureLayer({
        url: env.map.featureServiceUrl,
        token: env.map.apiKey || undefined,
        style: () => PARCEL_STYLE,
      }).addTo(map);
    }

    mapRef.current = map;
    // Leaflet needs a nudge when it starts inside a tab or a collapsed panel.
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ---- load geometry through the API and draw it ---- */
  useEffect(() => {
    if (!env.features.map) return undefined;
    let cancelled = false;

    (async () => {
      try {
        const [payload, gisStatus] = await Promise.all([api.get(query), api.get('/gis/status')]);
        if (cancelled) return;
        setStatus(gisStatus);

        const collection =
          payload.type === 'FeatureCollection'
            ? payload
            : { type: 'FeatureCollection', features: payload.feature ? [payload.feature] : [] };

        const map = mapRef.current;
        if (!map) return;

        if (overlayRef.current) {
          map.removeLayer(overlayRef.current);
          overlayRef.current = null;
        }

        if (collection.features.length === 0) {
          setError('No mapped shape is available for this property yet.');
          return;
        }
        setError(null);

        const layer = L.geoJSON(collection, {
          style: () => PARCEL_STYLE,
          onEachFeature: (feature, featureLayer) => {
            const props = feature.properties ?? {};
            featureLayer.bindPopup(
              `<strong>${escapeHtml(props.name ?? props.parcelId ?? 'Parcel')}</strong><br/>` +
                `${escapeHtml(props.parcelId ?? '')}<br/>` +
                `${props.acres ? `${escapeHtml(String(props.acres))} acres<br/>` : ''}` +
                `${props.county ? `${escapeHtml(props.county)} County` : ''}`
            );
            featureLayer.on('click', () => onFeatureClick?.(feature));
          },
        }).addTo(map);

        overlayRef.current = layer;
        map.fitBounds(layer.getBounds(), { padding: [24, 24], maxZoom: env.map.maxZoom - 4 });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query, onFeatureClick]);

  /* ---- layer switcher ---- */
  useEffect(() => {
    const layer = overlayRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    const shouldShow = visibleLayers.has('parcels');
    if (shouldShow && !map.hasLayer(layer)) layer.addTo(map);
    if (!shouldShow && map.hasLayer(layer)) map.removeLayer(layer);
  }, [visibleLayers]);

  if (!env.features.map) {
    return (
      <Alert severity="info">The map is switched off in this environment (VITE_FEATURE_MAP=false).</Alert>
    );
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 1 }}>
        <Box ref={containerRef} sx={{ height, width: '100%', bgcolor: '#e9eef2' }} />
      </Paper>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        sx={{ mt: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {status && (
            <Chip
              size="small"
              variant="outlined"
              color={status.live ? 'success' : 'default'}
              label={status.live ? `Live GIS (${status.provider})` : `Sample data (${status.provider})`}
            />
          )}
          {showLayerSwitcher &&
            env.map.layers.map((name) => (
              <FormControlLabel
                key={name}
                sx={{ mr: 0 }}
                control={
                  <Switch
                    size="small"
                    checked={visibleLayers.has(name)}
                    onChange={(e) => {
                      const next = new Set(visibleLayers);
                      if (e.target.checked) next.add(name);
                      else next.delete(name);
                      setVisibleLayers(next);
                    }}
                  />
                }
                label={<Typography variant="caption">{name}</Typography>}
              />
            ))}
        </Stack>

        {error && (
          <Typography variant="caption" color="text.secondary">
            {error}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

const PARCEL_STYLE = { color: '#1b4965', weight: 2, fillColor: '#5fa8d3', fillOpacity: 0.35 };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
