import { createTheme } from '@mui/material/styles';

/** One theme for the whole app so screens stay consistent without custom CSS. */
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1b4965' },
    secondary: { main: '#5fa8d3' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
    success: { main: '#2e7d32' },
    warning: { main: '#ed6c02' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #e2e6ea' } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: 'none' } } },
    MuiAppBar: { defaultProps: { elevation: 0 } },
  },
});

export default theme;
