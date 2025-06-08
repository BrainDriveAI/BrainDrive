import json
import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Tuple
from bs4 import BeautifulSoup
import unicodedata
from keybert import KeyBERT
from logging.handlers import RotatingFileHandler

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
os.makedirs('logs', exist_ok=True)
file_handler = RotatingFileHandler('logs/keyword_mapping.log', maxBytes=10*1024*1024, backupCount=5)
file_handler.setFormatter(formatter)
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(file_handler)
logger.addHandler(console_handler)

# Initialize KeyBERT for keyword extraction
kw_model = KeyBERT()

# Slugify function for clean URLs
def slugify(title: str) -> str:
    slug = re.sub(r'[^\w\s-]', '', title)  # Remove punctuation except hyphens/underscores
    slug = slug.replace(' ', '-')
    slug = re.sub(r'-+', '-', slug)  # Collapse multiple hyphens
    return slug.lower()

def clean_forum_text(html_content: str) -> str:
    """Clean HTML content from forum posts."""
    logger.info("Cleaning forum HTML content")
    try:
        soup = BeautifulSoup(html_content, "html.parser")
        text = soup.get_text(separator=" ")
        text = unicodedata.normalize("NFKD", text)
        text = re.sub(r"https://community\.braindrive\.ai/images/emoji/[^ ]+", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        logger.info(f"Cleaned text length: {len(text)} characters")
        return text
    except Exception as e:
        logger.error(f"Error cleaning forum text: {str(e)}")
        return ""

def extract_keywords(text: str, top_n: int = 10) -> List[Tuple[str, float]]:
    """Extract keyphrases from text using KeyBERT, excluding 'braindrive' and generic terms."""
    logger.info(f"Extracting keywords from text (length: {len(text)})")
    try:
        # Extended stopwords including 'braindrive'
        stop_words = ['english', 'braindrive', 'welcome', 'start', 'here', 'getting', 'started']
        keywords = kw_model.extract_keywords(
            text,
            keyphrase_ngram_range=(1, 2),  # Uni- and bigrams
            stop_words=stop_words,
            top_n=top_n,
            diversity=0.7  # Avoid similar keywords
        )
        # Filter keywords with score above threshold
        filtered_keywords = [(kw, score) for kw, score in keywords if score > 0.3]
        logger.info(f"Extracted keywords: {filtered_keywords}")
        return filtered_keywords
    except Exception as e:
        logger.error(f"Error extracting keywords: {str(e)}")
        return []

def process_forum_json(json_file: str, base_url: str = "https://community.braindrive.ai/t/") -> Dict[str, List[Dict]]:
    """Process forum JSON to extract keywords and map to topic URLs."""
    logger.info(f"Processing forum JSON: {json_file}")
    keyword_map: Dict[str, List[Dict]] = {}
    
    try:
        with open(json_file, 'r', encoding='utf-8') as f:
            forum_data = json.load(f)
        logger.info(f"Loaded JSON with {len(forum_data)} categories")
    except Exception as e:
        logger.error(f"Error reading {json_file}: {str(e)}")
        return keyword_map

    for category in forum_data:
        category_name = category['category_name']
        for topic in category['topics']:
            topic_id = topic.get('id', slugify(topic['title']))
            topic_title = topic['title']
            content = clean_forum_text(topic['content'])
            if not content:
                continue
            keywords = extract_keywords(content)
            topic_url = f"{base_url}{topic_id}"
            
            for keyword, score in keywords:
                if keyword.lower() == 'braindrive':
                    continue  # Explicitly skip 'braindrive'
                if keyword not in keyword_map:
                    keyword_map[keyword] = []
                keyword_map[keyword].append({
                    "url": topic_url,
                    "source": "forum",
                    "score": score,
                    "title": topic_title,
                    "category": category_name
                })
            logger.info(f"Mapped {len(keywords)} keywords for topic '{topic_title}'")

    return keyword_map

def save_keyword_map(keyword_map: Dict[str, List[Dict]], output_file: str):
    """Save the keyword-to-link mapping to a JSON file."""
    logger.info(f"Saving keyword map to {output_file}")
    try:
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(keyword_map, f, indent=2, ensure_ascii=False)
        logger.info(f"Successfully saved keyword map to {output_file}")
    except Exception as e:
        logger.error(f"Error saving keyword map: {str(e)}")

def main(forum_json: str, output_file: str = "data/keyword_link_map.json"):
    """Generate and save a keyword-to-link mapping from forums."""
    logger.info("Starting keyword-to-link mapping generation")
    
    keyword_map = process_forum_json(forum_json)
    save_keyword_map(keyword_map, output_file)
    
    logger.info(f"Generated mapping with {len(keyword_map)} keywords")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Generate keyword-to-link mapping for BrainDrive")
    parser.add_argument("forum_json", help="Path to forum JSON file")
    parser.add_argument("--output", default="data/keyword_link_map.json", help="Output JSON file")
    args = parser.parse_args()
    
    main(args.forum_json, args.output)