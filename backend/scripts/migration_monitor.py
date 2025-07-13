#!/usr/bin/env python3
"""
Migration Monitoring and Health Check System
Provides comprehensive monitoring, health checks, and alerting for database migrations.

Usage: python scripts/migration_monitor.py [options]
"""

import sys
import os
import json
import time
import smtplib
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import argparse

# Optional email imports
try:
    from email.mime.text import MimeText
    from email.mime.multipart import MimeMultipart
    EMAIL_AVAILABLE = True
except ImportError:
    EMAIL_AVAILABLE = False

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import sqlalchemy as sa
    from sqlalchemy import inspect, text
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
except ImportError as e:
    print(f"❌ Required dependencies not found: {e}")
    print("Please install: pip install sqlalchemy alembic")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class MigrationHealthStatus:
    """Container for migration health status."""
    
    def __init__(self):
        self.timestamp = datetime.now()
        self.overall_status = "UNKNOWN"
        self.checks = {}
        self.metrics = {}
        self.alerts = []
        self.warnings = []
        
    def add_check(self, name: str, status: str, message: str = "", details: Dict = None):
        """Add a health check result."""
        self.checks[name] = {
            'status': status,
            'message': message,
            'details': details or {},
            'timestamp': datetime.now().isoformat()
        }
        
    def add_metric(self, name: str, value: Any, unit: str = ""):
        """Add a metric."""
        self.metrics[name] = {
            'value': value,
            'unit': unit,
            'timestamp': datetime.now().isoformat()
        }
        
    def add_alert(self, level: str, message: str, details: Dict = None):
        """Add an alert."""
        self.alerts.append({
            'level': level,
            'message': message,
            'details': details or {},
            'timestamp': datetime.now().isoformat()
        })
        
    def add_warning(self, message: str, details: Dict = None):
        """Add a warning."""
        self.warnings.append({
            'message': message,
            'details': details or {},
            'timestamp': datetime.now().isoformat()
        })
        
    def calculate_overall_status(self):
        """Calculate overall health status based on checks."""
        if not self.checks:
            self.overall_status = "UNKNOWN"
            return
            
        statuses = [check['status'] for check in self.checks.values()]
        
        if any(status == "CRITICAL" for status in statuses):
            self.overall_status = "CRITICAL"
        elif any(status == "ERROR" for status in statuses):
            self.overall_status = "ERROR"
        elif any(status == "WARNING" for status in statuses):
            self.overall_status = "WARNING"
        elif all(status == "OK" for status in statuses):
            self.overall_status = "HEALTHY"
        else:
            self.overall_status = "UNKNOWN"
            
    def to_dict(self) -> Dict:
        """Convert to dictionary."""
        return {
            'timestamp': self.timestamp.isoformat(),
            'overall_status': self.overall_status,
            'checks': self.checks,
            'metrics': self.metrics,
            'alerts': self.alerts,
            'warnings': self.warnings
        }

class MigrationMonitor:
    """Migration monitoring and health check system."""
    
    def __init__(self, backend_dir: str = ".", config_file: str = None):
        self.backend_dir = Path(backend_dir)
        self.config = self._load_config(config_file)
        self.history_file = Path("migration_health_history.json")
        
    def _load_config(self, config_file: str = None) -> Dict:
        """Load monitoring configuration."""
        default_config = {
            'database_url': os.getenv('DATABASE_URL', 'sqlite:///braindrive.db'),
            'health_check_interval': 300,  # 5 minutes
            'alert_thresholds': {
                'migration_time_warning': 10.0,  # seconds
                'migration_time_critical': 30.0,  # seconds
                'pending_migrations_warning': 1,
                'pending_migrations_critical': 5
            },
            'email_alerts': {
                'enabled': False,
                'smtp_server': 'localhost',
                'smtp_port': 587,
                'username': '',
                'password': '',
                'from_email': 'migration-monitor@braindrive.local',
                'to_emails': []
            },
            'webhook_alerts': {
                'enabled': False,
                'url': '',
                'headers': {}
            }
        }
        
        if config_file and Path(config_file).exists():
            try:
                with open(config_file, 'r') as f:
                    user_config = json.load(f)
                    default_config.update(user_config)
            except Exception as e:
                logger.warning(f"Failed to load config file {config_file}: {e}")
                
        return default_config
        
    def check_database_connectivity(self) -> Dict:
        """Check database connectivity."""
        try:
            engine = sa.create_engine(self.config['database_url'])
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            engine.dispose()
            
            return {
                'status': 'OK',
                'message': 'Database connection successful'
            }
        except Exception as e:
            return {
                'status': 'CRITICAL',
                'message': f'Database connection failed: {str(e)}'
            }
            
    def check_alembic_version_table(self) -> Dict:
        """Check if Alembic version table exists and is valid."""
        try:
            engine = sa.create_engine(self.config['database_url'])
            inspector = inspect(engine)
            
            tables = inspector.get_table_names()
            if 'alembic_version' not in tables:
                return {
                    'status': 'ERROR',
                    'message': 'Alembic version table not found'
                }
                
            # Check version table content
            with engine.connect() as conn:
                result = conn.execute(text("SELECT version_num FROM alembic_version"))
                versions = result.fetchall()
                
                if not versions:
                    return {
                        'status': 'WARNING',
                        'message': 'Alembic version table is empty'
                    }
                    
                if len(versions) > 1:
                    return {
                        'status': 'ERROR',
                        'message': f'Multiple version entries found: {len(versions)}'
                    }
                    
            engine.dispose()
            return {
                'status': 'OK',
                'message': f'Alembic version table valid, current version: {versions[0][0]}'
            }
            
        except Exception as e:
            return {
                'status': 'ERROR',
                'message': f'Failed to check Alembic version table: {str(e)}'
            }
            
    def check_pending_migrations(self) -> Dict:
        """Check for pending migrations."""
        try:
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", self.config['database_url'])
            
            script_dir = ScriptDirectory.from_config(config)
            
            # Get current revision
            engine = sa.create_engine(self.config['database_url'])
            with engine.connect() as conn:
                context = MigrationContext.configure(conn)
                current_rev = context.get_current_revision()
                
            # Get head revision
            head_rev = script_dir.get_current_head()
            
            if current_rev == head_rev:
                return {
                    'status': 'OK',
                    'message': 'No pending migrations',
                    'details': {
                        'current_revision': current_rev,
                        'head_revision': head_rev
                    }
                }
            else:
                # Count pending migrations
                pending_revisions = []
                for rev in script_dir.walk_revisions(head_rev, current_rev):
                    if rev.revision != current_rev:
                        pending_revisions.append(rev.revision)
                        
                pending_count = len(pending_revisions)
                thresholds = self.config['alert_thresholds']
                
                if pending_count >= thresholds['pending_migrations_critical']:
                    status = 'CRITICAL'
                elif pending_count >= thresholds['pending_migrations_warning']:
                    status = 'WARNING'
                else:
                    status = 'OK'
                    
                return {
                    'status': status,
                    'message': f'{pending_count} pending migrations',
                    'details': {
                        'current_revision': current_rev,
                        'head_revision': head_rev,
                        'pending_count': pending_count,
                        'pending_revisions': pending_revisions
                    }
                }
                
            engine.dispose()
            
        except Exception as e:
            return {
                'status': 'ERROR',
                'message': f'Failed to check pending migrations: {str(e)}'
            }
            
    def check_migration_history_integrity(self) -> Dict:
        """Check migration history integrity."""
        try:
            config = Config("alembic.ini")
            script_dir = ScriptDirectory.from_config(config)
            
            # Check for broken migration chain
            revisions = list(script_dir.walk_revisions())
            revision_map = {rev.revision: rev for rev in revisions}
            
            broken_links = []
            for rev in revisions:
                if rev.down_revision:
                    if isinstance(rev.down_revision, tuple):
                        # Handle merge migrations
                        for down_rev in rev.down_revision:
                            if down_rev not in revision_map:
                                broken_links.append(f"{rev.revision} -> {down_rev}")
                    else:
                        if rev.down_revision not in revision_map:
                            broken_links.append(f"{rev.revision} -> {rev.down_revision}")
                            
            if broken_links:
                return {
                    'status': 'ERROR',
                    'message': f'Broken migration links found: {len(broken_links)}',
                    'details': {'broken_links': broken_links}
                }
            else:
                return {
                    'status': 'OK',
                    'message': 'Migration history integrity verified',
                    'details': {'total_migrations': len(revisions)}
                }
                
        except Exception as e:
            return {
                'status': 'ERROR',
                'message': f'Failed to check migration history: {str(e)}'
            }
            
    def check_database_schema_consistency(self) -> Dict:
        """Check database schema consistency with models."""
        try:
            # This is a simplified check - in practice, you'd compare with actual models
            engine = sa.create_engine(self.config['database_url'])
            inspector = inspect(engine)
            
            tables = inspector.get_table_names()
            table_count = len(tables)
            
            # Basic consistency checks
            issues = []
            
            # Check for common required tables
            expected_tables = ['alembic_version']  # Add your core tables here
            for table in expected_tables:
                if table not in tables:
                    issues.append(f"Missing required table: {table}")
                    
            # Check for orphaned foreign keys (simplified)
            for table_name in tables:
                try:
                    foreign_keys = inspector.get_foreign_keys(table_name)
                    for fk in foreign_keys:
                        referred_table = fk['referred_table']
                        if referred_table not in tables:
                            issues.append(f"Orphaned foreign key in {table_name} -> {referred_table}")
                except Exception:
                    continue
                    
            engine.dispose()
            
            if issues:
                return {
                    'status': 'WARNING',
                    'message': f'Schema consistency issues found: {len(issues)}',
                    'details': {
                        'table_count': table_count,
                        'issues': issues
                    }
                }
            else:
                return {
                    'status': 'OK',
                    'message': 'Database schema consistency verified',
                    'details': {'table_count': table_count}
                }
                
        except Exception as e:
            return {
                'status': 'ERROR',
                'message': f'Failed to check schema consistency: {str(e)}'
            }
            
    def collect_performance_metrics(self) -> Dict:
        """Collect migration performance metrics."""
        metrics = {}
        
        try:
            # Database size
            if self.config['database_url'].startswith('sqlite:///'):
                db_path = self.config['database_url'].replace('sqlite:///', '')
                if os.path.exists(db_path):
                    metrics['database_size_bytes'] = os.path.getsize(db_path)
                    
            # Connection pool metrics (if available)
            engine = sa.create_engine(self.config['database_url'])
            pool = engine.pool
            
            metrics.update({
                'connection_pool_size': pool.size(),
                'connection_pool_checked_in': pool.checkedin(),
                'connection_pool_checked_out': pool.checkedout(),
                'connection_pool_overflow': pool.overflow(),
                'connection_pool_invalid': pool.invalidated()
            })
            
            engine.dispose()
            
        except Exception as e:
            logger.warning(f"Failed to collect some performance metrics: {e}")
            
        return metrics
        
    def run_health_check(self) -> MigrationHealthStatus:
        """Run comprehensive health check."""
        status = MigrationHealthStatus()
        
        # Database connectivity
        result = self.check_database_connectivity()
        status.add_check("database_connectivity", result['status'], result['message'])
        
        # Alembic version table
        result = self.check_alembic_version_table()
        status.add_check("alembic_version_table", result['status'], result['message'])
        
        # Pending migrations
        result = self.check_pending_migrations()
        status.add_check("pending_migrations", result['status'], result['message'], result.get('details'))
        
        # Migration history integrity
        result = self.check_migration_history_integrity()
        status.add_check("migration_history_integrity", result['status'], result['message'], result.get('details'))
        
        # Schema consistency
        result = self.check_database_schema_consistency()
        status.add_check("schema_consistency", result['status'], result['message'], result.get('details'))
        
        # Performance metrics
        metrics = self.collect_performance_metrics()
        for name, value in metrics.items():
            status.add_metric(name, value)
            
        # Calculate overall status
        status.calculate_overall_status()
        
        # Generate alerts based on status
        self._generate_alerts(status)
        
        return status
        
    def _generate_alerts(self, status: MigrationHealthStatus):
        """Generate alerts based on health status."""
        # Critical alerts
        for check_name, check in status.checks.items():
            if check['status'] == 'CRITICAL':
                status.add_alert('CRITICAL', f"Critical issue in {check_name}: {check['message']}")
            elif check['status'] == 'ERROR':
                status.add_alert('ERROR', f"Error in {check_name}: {check['message']}")
            elif check['status'] == 'WARNING':
                status.add_warning(f"Warning in {check_name}: {check['message']}")
                
        # Performance-based alerts
        thresholds = self.config['alert_thresholds']
        
        # Check pending migrations count
        pending_check = status.checks.get('pending_migrations', {})
        if pending_check.get('details', {}).get('pending_count', 0) >= thresholds['pending_migrations_critical']:
            status.add_alert('CRITICAL', "Too many pending migrations")
            
    def send_email_alert(self, status: MigrationHealthStatus):
        """Send email alert."""
        if not self.config['email_alerts']['enabled'] or not EMAIL_AVAILABLE:
            if not EMAIL_AVAILABLE:
                logger.warning("Email alerts disabled: email modules not available")
            return
            
        try:
            email_config = self.config['email_alerts']
            
            msg = MimeMultipart()
            msg['From'] = email_config['from_email']
            msg['To'] = ', '.join(email_config['to_emails'])
            msg['Subject'] = f"Migration Health Alert - {status.overall_status}"
            
            # Create email body
            body = f"""
Migration Health Status: {status.overall_status}
Timestamp: {status.timestamp}

Health Checks:
"""
            for name, check in status.checks.items():
                body += f"- {name}: {check['status']} - {check['message']}\n"
                
            if status.alerts:
                body += "\nAlerts:\n"
                for alert in status.alerts:
                    body += f"- {alert['level']}: {alert['message']}\n"
                    
            if status.warnings:
                body += "\nWarnings:\n"
                for warning in status.warnings:
                    body += f"- {warning['message']}\n"
                    
            msg.attach(MimeText(body, 'plain'))
            
            # Send email
            server = smtplib.SMTP(email_config['smtp_server'], email_config['smtp_port'])
            if email_config['username']:
                server.starttls()
                server.login(email_config['username'], email_config['password'])
                
            server.send_message(msg)
            server.quit()
            
            logger.info("Email alert sent successfully")
            
        except Exception as e:
            logger.error(f"Failed to send email alert: {e}")
            
    def send_webhook_alert(self, status: MigrationHealthStatus):
        """Send webhook alert."""
        if not self.config['webhook_alerts']['enabled']:
            return
            
        try:
            import requests
            
            webhook_config = self.config['webhook_alerts']
            payload = {
                'status': status.overall_status,
                'timestamp': status.timestamp.isoformat(),
                'checks': status.checks,
                'alerts': status.alerts,
                'warnings': status.warnings
            }
            
            response = requests.post(
                webhook_config['url'],
                json=payload,
                headers=webhook_config.get('headers', {}),
                timeout=30
            )
            
            response.raise_for_status()
            logger.info("Webhook alert sent successfully")
            
        except Exception as e:
            logger.error(f"Failed to send webhook alert: {e}")
            
    def save_health_history(self, status: MigrationHealthStatus):
        """Save health check history."""
        try:
            history = []
            if self.history_file.exists():
                with open(self.history_file, 'r') as f:
                    history = json.load(f)
                    
            # Add current status
            history.append(status.to_dict())
            
            # Keep only last 100 entries
            history = history[-100:]
            
            with open(self.history_file, 'w') as f:
                json.dump(history, f, indent=2)
                
        except Exception as e:
            logger.error(f"Failed to save health history: {e}")
            
    def monitor_continuous(self, interval: int = None):
        """Run continuous monitoring."""
        interval = interval or self.config['health_check_interval']
        
        logger.info(f"Starting continuous monitoring (interval: {interval}s)")
        
        try:
            while True:
                status = self.run_health_check()
                
                # Print status
                print(f"\n[{datetime.now()}] Migration Health: {status.overall_status}")
                
                # Send alerts if needed
                if status.alerts:
                    self.send_email_alert(status)
                    self.send_webhook_alert(status)
                    
                # Save history
                self.save_health_history(status)
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Monitoring error: {e}")

def main():
    parser = argparse.ArgumentParser(description="Migration Monitoring System")
    parser.add_argument("--backend-dir", default="backend", help="Backend directory path")
    parser.add_argument("--config", help="Configuration file path")
    parser.add_argument("--continuous", action="store_true", help="Run continuous monitoring")
    parser.add_argument("--interval", type=int, help="Monitoring interval in seconds")
    parser.add_argument("--output", help="Output health status to JSON file")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
        
    monitor = MigrationMonitor(args.backend_dir, args.config)
    
    if args.continuous:
        monitor.monitor_continuous(args.interval)
    else:
        # Single health check
        status = monitor.run_health_check()
        
        # Print results
        print("🏥 Migration Health Check Results")
        print("=" * 40)
        print(f"Overall Status: {status.overall_status}")
        print(f"Timestamp: {status.timestamp}")
        
        print("\nHealth Checks:")
        for name, check in status.checks.items():
            status_icon = {"OK": "✅", "WARNING": "⚠️", "ERROR": "❌", "CRITICAL": "🚨"}.get(check['status'], "❓")
            print(f"  {status_icon} {name}: {check['status']} - {check['message']}")
            
        if status.metrics:
            print("\nMetrics:")
            for name, metric in status.metrics.items():
                print(f"  📊 {name}: {metric['value']} {metric['unit']}")
                
        if status.alerts:
            print("\nAlerts:")
            for alert in status.alerts:
                alert_icon = {"CRITICAL": "🚨", "ERROR": "❌", "WARNING": "⚠️"}.get(alert['level'], "ℹ️")
                print(f"  {alert_icon} {alert['level']}: {alert['message']}")
                
        if status.warnings:
            print("\nWarnings:")
            for warning in status.warnings:
                print(f"  ⚠️ {warning['message']}")
                
        # Save results if requested
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(status.to_dict(), f, indent=2)
            print(f"\n📄 Results saved to: {args.output}")
            
        # Save to history
        monitor.save_health_history(status)
        
        # Return appropriate exit code
        return 1 if status.overall_status in ['ERROR', 'CRITICAL'] else 0

if __name__ == "__main__":
    sys.exit(main())