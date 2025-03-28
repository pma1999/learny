import React, { useState, useEffect, useRef } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import { sanitizeContent } from '../utils/sanitizer';
import {
  Typography,
  Box,
  Container,
  Paper,
  Button,
  Card,
  CardContent,
  Grid,
  Divider,
  TextField,
  IconButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  Skeleton,
  Snackbar,
  Alert,
  CircularProgress,
  Stack,
  InputAdornment,
  useMediaQuery,
  Slide,
  useTheme
} from '@mui/material';
import { styled } from '@mui/material/styles';
import HistoryIcon from '@mui/icons-material/History';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LabelIcon from '@mui/icons-material/Label';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import StorageIcon from '@mui/icons-material/Storage';

import MarkdownRenderer from '../components/MarkdownRenderer';
import * as api from '../services/api';

// Helper function to sanitize content is now imported from sanitizer.js

// Helper functions
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Styled components
const StyledCard = styled(Card)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease, all 0.3s ease-in-out',
  '&:hover': {
    transform: 'translateY(-4px)',
    boxShadow: theme.shadows[4],
  }
}));

const StyledChip = styled(Chip)(({ theme }) => ({
  margin: theme.spacing(0.5),
}));

const ActionButtonsWrapper = styled(Stack)(({ theme }) => ({
  [theme.breakpoints.down('sm')]: {
    marginTop: theme.spacing(2),
    justifyContent: 'flex-start',
    width: '100%',
  },
}));

const PageHeaderWrapper = styled(Box)(({ theme }) => ({
  display: 'flex', 
  justifyContent: 'space-between', 
  alignItems: 'flex-start',
  marginBottom: theme.spacing(3),
  [theme.breakpoints.down('sm')]: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
}));

// Component for the tags input and display
const TagsInput = ({ tags = [], onAddTag, onDeleteTag }) => {
  const [newTag, setNewTag] = useState('');

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      onAddTag(newTag.trim());
      setNewTag('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', mb: 1 }}>
        {tags.map((tag) => (
          <StyledChip
            key={tag}
            label={tag}
            onDelete={() => onDeleteTag(tag)}
            size="small"
            icon={<LabelIcon />}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex' }}>
        <TextField
          size="small"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add tag..."
          variant="outlined"
          fullWidth
          sx={{ mr: 1 }}
        />
        <Button
          size="small"
          variant="outlined"
          onClick={handleAddTag}
          disabled={!newTag.trim()}
        >
          Add
        </Button>
      </Box>
    </Box>
  );
};

// Confirmation dialog component
const ConfirmationDialog = ({ open, title, message, onConfirm, onCancel }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  return (
    <Dialog 
      open={open} 
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
      fullScreen={isMobile}
      TransitionComponent={Slide}
      TransitionProps={{ direction: 'up' }}
    >
      <DialogTitle>
        {isMobile && (
          <IconButton
            edge="start"
            color="inherit"
            onClick={onCancel}
            aria-label="close"
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
        )}
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ 
        px: { xs: 2, sm: 3 }, 
        py: { xs: 2, sm: 1 }, 
        flexDirection: isMobile ? 'column' : 'row', 
        alignItems: isMobile ? 'stretch' : 'center' 
      }}>
        <Button 
          onClick={onCancel} 
          color="primary"
          fullWidth={isMobile}
          sx={{ mb: isMobile ? 1 : 0 }}
        >
          Cancel
        </Button>
        <Button 
          onClick={onConfirm} 
          color="primary" 
          variant="contained" 
          autoFocus
          fullWidth={isMobile}
        >
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// Import dialog component
const ImportDialog = ({ open, onClose, onImport }) => {
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleImport = async () => {
    if (!jsonInput.trim()) {
      setError('Please enter JSON data or upload a file');
      return;
    }

    try {
      setLoading(true);
      setError('');
      // Validate JSON
      JSON.parse(jsonInput);
      await onImport(jsonInput);
      onClose();
    } catch (err) {
      setError(err.message || 'Invalid JSON format');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Check file type
    if (!file.name.endsWith('.json')) {
      setError('Please upload a JSON file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result;
        // Validate JSON
        JSON.parse(content);
        setJsonInput(content);
        setError('');
      } catch (err) {
        setError('The uploaded file contains invalid JSON');
      }
    };

    reader.onerror = () => {
      setError('Error reading the file');
    };

    reader.readAsText(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (!file.name.endsWith('.json')) {
        setError('Please upload a JSON file');
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          JSON.parse(content); // Validate JSON
          setJsonInput(content);
          setError('');
        } catch (err) {
          setError('The uploaded file contains invalid JSON');
        }
      };
      
      reader.onerror = () => {
        setError('Error reading the file');
      };
      
      reader.readAsText(file);
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={onClose} 
      maxWidth="md" 
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>
        {isMobile && (
          <IconButton
            edge="start"
            color="inherit"
            onClick={onClose}
            aria-label="close"
            sx={{ mr: 2 }}
          >
            <ArrowBackIcon />
          </IconButton>
        )}
        Import Learning Path
      </DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Paste a valid learning path JSON or upload a JSON file to import it into your history.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            p: { xs: 1, sm: 2 },
            mb: 2,
            textAlign: 'center',
            cursor: 'pointer'
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
            ref={fileInputRef}
          />
          <Typography sx={{ mb: 1, fontSize: { xs: '0.875rem', sm: '1rem' } }}>
            Drag & drop a JSON file here or click to browse
          </Typography>
          <Button
            variant="outlined"
            component="span"
            startIcon={<UploadIcon />}
            size={isMobile ? "small" : "medium"}
          >
            Choose File
          </Button>
        </Box>
        
        <Divider sx={{ my: 2 }}>
          <Typography variant="body2" color="text.secondary">OR</Typography>
        </Divider>
        
        <TextField
          multiline
          rows={isMobile ? 6 : 10}
          fullWidth
          variant="outlined"
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder="Paste your JSON here..."
          error={!!error}
        />
      </DialogContent>
      <DialogActions sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 1 }, flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center' }}>
        <Button 
          onClick={onClose}
          fullWidth={isMobile}
          sx={{ mb: isMobile ? 1 : 0 }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleImport}
          color="primary"
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : <UploadIcon />}
          fullWidth={isMobile}
        >
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// History entry card component
const HistoryEntryCard = ({ entry, onView, onDelete, onToggleFavorite, onUpdateTags, onExport }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleAddTag = async (newTag) => {
    const updatedTags = [...entry.tags, newTag];
    await onUpdateTags(entry.id, updatedTags);
  };

  const handleDeleteTag = async (tagToDelete) => {
    const updatedTags = entry.tags.filter(tag => tag !== tagToDelete);
    await onUpdateTags(entry.id, updatedTags);
  };

  return (
    <Grid item xs={12} sm={6} md={4}>
      <StyledCard variant="outlined">
        <CardContent sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ 
              fontWeight: 'medium', 
              fontSize: { xs: '1rem', sm: '1.15rem', md: '1.25rem' }
            }} noWrap>
              {entry.topic}
            </Typography>
            <IconButton
              color={entry.favorite ? "warning" : "default"}
              onClick={() => onToggleFavorite(entry.id, !entry.favorite)}
              size="small"
            >
              {entry.favorite ? <StarIcon /> : <StarBorderIcon />}
            </IconButton>
          </Box>
          
          <Typography variant="body2" color="text.secondary" gutterBottom fontSize={{ xs: '0.75rem', sm: '0.875rem' }}>
            Created: {formatDate(entry.creation_date)}
          </Typography>
          
          {entry.last_modified_date && (
            <Typography variant="body2" color="text.secondary" gutterBottom fontSize={{ xs: '0.75rem', sm: '0.875rem' }}>
              Modified: {formatDate(entry.last_modified_date)}
            </Typography>
          )}
          
          <Box sx={{ mt: 1, mb: 2, display: 'flex', flexWrap: 'wrap' }}>
            <Chip
              label={`${entry.modules_count || (entry.path_data && entry.path_data.modules ? entry.path_data.modules.length : 0)} modules`}
              size="small"
              sx={{ mr: 1, mb: { xs: 1, sm: 0 } }}
            />
            <Chip
              label={entry.source === 'generated' ? 'Generated' : 'Imported'}
              size="small"
              color={entry.source === 'generated' ? 'primary' : 'secondary'}
            />
          </Box>
          
          <TagsInput
            tags={entry.tags}
            onAddTag={handleAddTag}
            onDeleteTag={handleDeleteTag}
          />
          
          <Divider sx={{ my: 2 }} />
          
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            flexDirection: { xs: isMobile ? 'column' : 'row', sm: 'row' },
            alignItems: { xs: isMobile ? 'stretch' : 'center', sm: 'center' }
          }}>
            <Button
              startIcon={<ExpandMoreIcon />}
              onClick={() => onView(entry.id)}
              size="small"
              sx={{ mb: isMobile ? 1 : 0, width: isMobile ? '100%' : 'auto' }}
            >
              View Details
            </Button>
            
            <Box sx={{ display: 'flex', justifyContent: isMobile ? 'space-between' : 'flex-end', width: isMobile ? '100%' : 'auto' }}>
              <IconButton size="small" onClick={() => onExport(entry.id)} title="Export">
                <DownloadIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                color="error"
                onClick={() => setConfirmDelete(true)}
                title="Delete"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </CardContent>
        
        <ConfirmationDialog
          open={confirmDelete}
          title="Delete Learning Path"
          message={`Are you sure you want to delete "${entry.topic}"?`}
          onConfirm={() => {
            onDelete(entry.id);
            setConfirmDelete(false);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </StyledCard>
    </Grid>
  );
};

// History filters component
const HistoryFilters = ({ sortBy, onSortChange, filterSource, onFilterChange, search, onSearchChange }) => {
  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid item xs={12} sm={12} md={5}>
        <TextField
          fullWidth
          placeholder="Search by topic..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          size="small"
        />
      </Grid>
      <Grid item xs={6} sm={6} md={4}>
        <FormControl fullWidth size="small">
          <InputLabel id="sort-by-label">Sort By</InputLabel>
          <Select
            labelId="sort-by-label"
            value={sortBy}
            label="Sort By"
            onChange={(e) => onSortChange(e.target.value)}
          >
            <MenuItem value="creation_date">Creation Date</MenuItem>
            <MenuItem value="last_modified_date">Last Modified</MenuItem>
            <MenuItem value="topic">Topic</MenuItem>
            <MenuItem value="favorite">Favorites First</MenuItem>
          </Select>
        </FormControl>
      </Grid>
      <Grid item xs={6} sm={6} md={3}>
        <FormControl fullWidth size="small">
          <InputLabel id="filter-source-label">Source</InputLabel>
          <Select
            labelId="filter-source-label"
            value={filterSource || ''}
            label="Source"
            onChange={(e) => onFilterChange(e.target.value || null)}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="generated">Generated</MenuItem>
            <MenuItem value="imported">Imported</MenuItem>
          </Select>
        </FormControl>
      </Grid>
    </Grid>
  );
};

// Skeleton loader for history entries
const HistoryEntrySkeleton = () => (
  <Grid item xs={12} sm={6} md={4}>
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, md: 3 } }}>
        <Skeleton variant="text" width="70%" height={40} />
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" width="60%" />
        <Box sx={{ mt: 1, mb: 2, display: 'flex', flexWrap: 'wrap' }}>
          <Skeleton variant="rectangular" width={120} height={24} sx={{ borderRadius: 4, mr: 1 }} />
          <Skeleton variant="rectangular" width={100} height={24} sx={{ borderRadius: 4 }} />
        </Box>
        <Skeleton variant="rectangular" height={80} />
        <Divider sx={{ my: 2 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton variant="rectangular" width={100} height={30} sx={{ borderRadius: 1 }} />
          <Box>
            <Skeleton variant="circular" width={24} height={24} sx={{ display: 'inline-block', mr: 1 }} />
            <Skeleton variant="circular" width={24} height={24} sx={{ display: 'inline-block' }} />
          </Box>
        </Box>
      </CardContent>
    </Card>
  </Grid>
);

// Main HistoryPage component
function HistoryPage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // States
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [clearHistoryDialog, setClearHistoryDialog] = useState(false);
  const [notification, setNotification] = useState({ open: false, message: '', severity: 'info' });
  
  // Filter states
  const [sortBy, setSortBy] = useState('creation_date');
  const [filterSource, setFilterSource] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Load history data
  const loadHistory = async () => {
    try {
      setLoading(true);
      const response = await api.getHistoryPreview(sortBy, filterSource, searchTerm);
      setEntries(response.entries || []);
    } catch (error) {
      showNotification('Error loading history: ' + (error.message || 'Unknown error'), 'error');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    loadHistory();
  }, [sortBy, filterSource, searchTerm]);
  
  // View a learning path
  const handleViewLearningPath = async (entryId) => {
    setLoading(true);
    try {
      navigate(`/history/${entryId}`);
    } catch (error) {
      console.error('Error loading learning path:', error);
      showNotification('Error loading learning path: ' + (error.message || 'Unknown error'), 'error');
      setLoading(false);
    }
  };
  
  // Delete a learning path
  const handleDeleteLearningPath = async (entryId) => {
    try {
      await api.deleteHistoryEntry(entryId);
      showNotification('Learning path deleted successfully', 'success');
      loadHistory();
    } catch (error) {
      showNotification('Error deleting learning path: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Toggle favorite status
  const handleToggleFavorite = async (entryId, favoriteStatus) => {
    try {
      await api.updateHistoryEntry(entryId, { favorite: favoriteStatus });
      showNotification(
        favoriteStatus ? 'Added to favorites' : 'Removed from favorites',
        'success'
      );
      loadHistory();
    } catch (error) {
      showNotification('Error updating favorite status: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Update tags
  const handleUpdateTags = async (entryId, tags) => {
    try {
      await api.updateHistoryEntry(entryId, { tags });
      showNotification('Tags updated successfully', 'success');
      loadHistory();
    } catch (error) {
      showNotification('Error updating tags: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Export a learning path
  const handleExportLearningPath = async (entryId) => {
    try {
      const response = await api.getHistoryEntry(entryId);
      const learningPath = response.entry.path_data;
      
      // Create a JSON file and trigger download
      const json = JSON.stringify(learningPath, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `learning_path_${learningPath.topic.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showNotification('Learning path exported successfully', 'success');
    } catch (error) {
      showNotification('Error exporting learning path: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Export all history
  const handleExportAllHistory = async () => {
    try {
      const response = await api.exportHistory();
      
      // Create a JSON file and trigger download
      const json = JSON.stringify(response, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const date = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `learning_path_history_${date}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showNotification('History exported successfully', 'success');
    } catch (error) {
      showNotification('Error exporting history: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Import a learning path
  const handleImportLearningPath = async (jsonData) => {
    try {
      const response = await api.importLearningPath(jsonData);
      showNotification(`Learning path "${response.topic}" imported successfully`, 'success');
      loadHistory();
    } catch (error) {
      showNotification('Error importing learning path: ' + (error.message || 'Unknown error'), 'error');
      throw error; // Re-throw so the dialog can handle it
    }
  };
  
  // Clear all history
  const handleClearHistory = async () => {
    try {
      await api.clearHistory();
      showNotification('History cleared successfully', 'success');
      loadHistory();
      setClearHistoryDialog(false);
    } catch (error) {
      showNotification('Error clearing history: ' + (error.message || 'Unknown error'), 'error');
    }
  };
  
  // Show notification
  const showNotification = (message, severity = 'info') => {
    setNotification({
      open: true,
      message,
      severity,
    });
  };
  
  // Handle notification close
  const handleNotificationClose = () => {
    setNotification({ ...notification, open: false });
  };
  
  return (
    <Container maxWidth="lg">
      <Paper elevation={3} sx={{ p: { xs: 2, sm: 3, md: 4 }, borderRadius: 2, mb: 4 }}>
        <PageHeaderWrapper>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <HistoryIcon sx={{ mr: 1, fontSize: { xs: 24, sm: 32 }, color: 'primary.main' }} />
              <Typography variant="h4" component="h1" sx={{ 
                fontWeight: 'bold',
                fontSize: { xs: '1.5rem', sm: '2rem', md: '2.125rem' }
              }}>
                Learning Path History
              </Typography>
            </Box>
            <Chip
              icon={<StorageIcon />}
              label="Stored locally in your browser"
              size="small"
              color="secondary"
              variant="outlined"
              sx={{ mt: 1, mb: 1 }}
            />
          </Box>
          
          <ActionButtonsWrapper 
            direction={{ xs: 'column', sm: 'row' }} 
            spacing={{ xs: 1, sm: 2 }}
          >
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => setImportDialogOpen(true)}
              fullWidth={isMobile}
              size="small"
            >
              Import
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExportAllHistory}
              disabled={entries.length === 0}
              fullWidth={isMobile}
              size="small"
            >
              Export All
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<ClearAllIcon />}
              onClick={() => setClearHistoryDialog(true)}
              disabled={entries.length === 0}
              fullWidth={isMobile}
              size="small"
            >
              Clear All
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              component={RouterLink}
              to="/generator"
              fullWidth={isMobile}
              size="small"
            >
              Create New Path
            </Button>
          </ActionButtonsWrapper>
        </PageHeaderWrapper>
        
        <Divider sx={{ mb: 3 }} />
        
        <HistoryFilters
          sortBy={sortBy}
          onSortChange={setSortBy}
          filterSource={filterSource}
          onFilterChange={setFilterSource}
          search={searchTerm}
          onSearchChange={setSearchTerm}
        />
        
        {loading ? (
          <Grid container spacing={2}>
            {[...Array(6)].map((_, index) => (
              <HistoryEntrySkeleton key={index} />
            ))}
          </Grid>
        ) : entries.length > 0 ? (
          <Grid container spacing={2}>
            {entries.map((entry) => (
              <HistoryEntryCard
                key={entry.id}
                entry={entry}
                onView={handleViewLearningPath}
                onDelete={handleDeleteLearningPath}
                onToggleFavorite={handleToggleFavorite}
                onUpdateTags={handleUpdateTags}
                onExport={handleExportLearningPath}
              />
            ))}
          </Grid>
        ) : (
          <Box sx={{ textAlign: 'center', py: { xs: 3, sm: 5 } }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No learning paths found
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Create your first learning path or import one to get started.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              component={RouterLink}
              to="/generator"
              sx={{ mt: 2 }}
            >
              Create Learning Path
            </Button>
          </Box>
        )}
      </Paper>
      
      {/* Import Dialog */}
      <ImportDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onImport={handleImportLearningPath}
      />
      
      {/* Clear History Confirmation Dialog */}
      <ConfirmationDialog
        open={clearHistoryDialog}
        title="Clear All History"
        message="Are you sure you want to delete all learning paths? This action cannot be undone."
        onConfirm={handleClearHistory}
        onCancel={() => setClearHistoryDialog(false)}
      />
      
      {/* Notification Snackbar */}
      <Snackbar
        open={notification.open}
        autoHideDuration={6000}
        onClose={handleNotificationClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={handleNotificationClose} severity={notification.severity} sx={{ width: '100%' }}>
          {notification.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default HistoryPage; 