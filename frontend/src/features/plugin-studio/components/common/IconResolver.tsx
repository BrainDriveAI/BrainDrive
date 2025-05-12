import React from 'react';
import { SvgIconProps } from '@mui/material';

// Import Material-UI icons
import ExtensionIcon from '@mui/icons-material/Extension';
import CategoryIcon from '@mui/icons-material/Category';
import CodeIcon from '@mui/icons-material/Code';
import ChatIcon from '@mui/icons-material/Chat';
import SettingsIcon from '@mui/icons-material/Settings';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DescriptionIcon from '@mui/icons-material/Description';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import StorageIcon from '@mui/icons-material/Storage';
import LanguageIcon from '@mui/icons-material/Language';
import BuildIcon from '@mui/icons-material/Build';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ApiIcon from '@mui/icons-material/Api';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DataObjectIcon from '@mui/icons-material/DataObject';
import TerminalIcon from '@mui/icons-material/Terminal';
import InsertChartIcon from '@mui/icons-material/InsertChart';
import ForumIcon from '@mui/icons-material/Forum';
import TranslateIcon from '@mui/icons-material/Translate';
import SearchIcon from '@mui/icons-material/Search';
import MenuIcon from '@mui/icons-material/Menu';
import HomeIcon from '@mui/icons-material/Home';
import InfoIcon from '@mui/icons-material/Info';
import HelpIcon from '@mui/icons-material/Help';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import UploadIcon from '@mui/icons-material/Upload';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import StopIcon from '@mui/icons-material/Stop';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import RepeatIcon from '@mui/icons-material/Repeat';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FilterListIcon from '@mui/icons-material/FilterList';
import SortIcon from '@mui/icons-material/Sort';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ViewComfyIcon from '@mui/icons-material/ViewComfy';
import GridViewIcon from '@mui/icons-material/GridView';
import TableViewIcon from '@mui/icons-material/TableView';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudIcon from '@mui/icons-material/Cloud';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import AttachmentIcon from '@mui/icons-material/Attachment';
import ImageIcon from '@mui/icons-material/Image';
import PhotoIcon from '@mui/icons-material/Photo';
import MovieIcon from '@mui/icons-material/Movie';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import CodeOffIcon from '@mui/icons-material/CodeOff';

// Map of icon names to components
const iconMap: Record<string, React.ComponentType<SvgIconProps>> = {
  ExtensionIcon,
  CategoryIcon,
  CodeIcon,
  ChatIcon,
  SettingsIcon,
  DashboardIcon,
  DescriptionIcon,
  FormatPaintIcon,
  StorageIcon,
  LanguageIcon,
  BuildIcon,
  AccountTreeIcon,
  ApiIcon,
  SmartToyIcon,
  PsychologyIcon,
  AutoAwesomeIcon,
  DataObjectIcon,
  TerminalIcon,
  InsertChartIcon,
  ForumIcon,
  TranslateIcon,
  SearchIcon,
  MenuIcon,
  HomeIcon,
  InfoIcon,
  HelpIcon,
  ErrorIcon,
  WarningIcon,
  CheckCircleIcon,
  CancelIcon,
  AddIcon,
  RemoveIcon,
  EditIcon,
  DeleteIcon,
  SaveIcon,
  UploadIcon,
  DownloadIcon,
  RefreshIcon,
  MoreVertIcon,
  MoreHorizIcon,
  ArrowBackIcon,
  ArrowForwardIcon,
  ArrowUpwardIcon,
  ArrowDownwardIcon,
  KeyboardArrowUpIcon,
  KeyboardArrowDownIcon,
  KeyboardArrowLeftIcon,
  KeyboardArrowRightIcon,
  ExpandMoreIcon,
  ExpandLessIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FirstPageIcon,
  LastPageIcon,
  PlayArrowIcon,
  PauseIcon,
  StopIcon,
  SkipPreviousIcon,
  SkipNextIcon,
  RepeatIcon,
  ShuffleIcon,
  VolumeUpIcon,
  VolumeDownIcon,
  VolumeMuteIcon,
  VolumeOffIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  ZoomInIcon,
  ZoomOutIcon,
  FilterListIcon,
  SortIcon,
  ViewListIcon,
  ViewModuleIcon,
  ViewComfyIcon,
  GridViewIcon,
  TableViewIcon,
  InsertDriveFileIcon,
  FolderIcon,
  FolderOpenIcon,
  CreateNewFolderIcon,
  CloudUploadIcon,
  CloudDownloadIcon,
  CloudIcon,
  CloudOffIcon,
  LinkIcon,
  LinkOffIcon,
  AttachFileIcon,
  AttachmentIcon,
  ImageIcon,
  PhotoIcon,
  MovieIcon,
  MusicNoteIcon,
  AudiotrackIcon,
  PictureAsPdfIcon,
  TextSnippetIcon,
  CodeOffIcon,
  
  // Aliases without "Icon" suffix
  Extension: ExtensionIcon,
  Category: CategoryIcon,
  Code: CodeIcon,
  Chat: ChatIcon,
  Settings: SettingsIcon,
  Dashboard: DashboardIcon,
  Description: DescriptionIcon,
  FormatPaint: FormatPaintIcon,
  Storage: StorageIcon,
  Language: LanguageIcon,
  Build: BuildIcon,
  AccountTree: AccountTreeIcon,
  Api: ApiIcon,
  SmartToy: SmartToyIcon,
  Psychology: PsychologyIcon,
  AutoAwesome: AutoAwesomeIcon,
  DataObject: DataObjectIcon,
  Terminal: TerminalIcon,
  InsertChart: InsertChartIcon,
  Forum: ForumIcon,
  Translate: TranslateIcon,
  Search: SearchIcon,
  Menu: MenuIcon,
  Home: HomeIcon,
  Info: InfoIcon,
  Help: HelpIcon,
  Error: ErrorIcon,
  Warning: WarningIcon,
  CheckCircle: CheckCircleIcon,
  Cancel: CancelIcon,
  Add: AddIcon,
  Remove: RemoveIcon,
  Edit: EditIcon,
  Delete: DeleteIcon,
  Save: SaveIcon,
  Upload: UploadIcon,
  Download: DownloadIcon,
  Refresh: RefreshIcon,
  MoreVert: MoreVertIcon,
  MoreHoriz: MoreHorizIcon,
};

interface IconResolverProps extends SvgIconProps {
  icon: string;
}

/**
 * Component that resolves icon names to Material-UI icon components
 * @param props The component props
 * @returns The resolved icon component
 */
export const IconResolver: React.FC<IconResolverProps> = ({ icon, ...props }) => {
  // Default to ExtensionIcon if the icon name is not found
  const IconComponent = iconMap[icon] || ExtensionIcon;
  
  return <IconComponent {...props} />;
};