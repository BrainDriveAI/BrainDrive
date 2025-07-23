import json
import logging
import re
from typing import List, Dict, Any
from collections import Counter
from nltk.stem import SnowballStemmer
from nltk.corpus import stopwords
import nltk

# Download NLTK data (run once)
try:
    nltk.data.find('corpora/stopwords')
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('stopwords')
    nltk.download('punkt')

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# Initialize stemmer
stemmer = SnowballStemmer("english")
stop_words = set(stopwords.words('english')).union({'braindrive'})

def load_keyword_map(map_file: str = "app/data/keyword_link_map.json") -> Dict[str, List[Dict]]:
    """Load the keyword-to-link mapping."""
    logger.info(f"Loading keyword map from {map_file}")
    try:
        with open(map_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error loading keyword map: {str(e)}")
        return {}

def match_keywords(text: str, keyword_map: Dict[str, List[Dict]], max_links: int = 3) -> List[Dict]:
    logger.info(f"Matching keywords in text (length: {len(text)})")
    text = text.lower()
    words = re.findall(r'\b\w+\b', text)
    stemmed_words = [stemmer.stem(word) for word in words if word not in stop_words]
    word_counts = Counter(stemmed_words)
    
    keyword_scores = []
    for keyword in keyword_map:
        if keyword == "error":
            continue  # Skip error entries
        keyword_words = keyword.lower().split()
        stemmed_keyword_words = [stemmer.stem(w) for w in keyword_words]
        match_count = sum(word_counts.get(stem, 0) for stem in stemmed_keyword_words)
        if match_count > 0:
            max_score = max((link['score'] for link in keyword_map[keyword]), default=0)
            keyword_scores.append((keyword, match_count, max_score))
    
    keyword_scores.sort(key=lambda x: (x[1], x[2]), reverse=True)
    matched_links = []
    seen_urls = set()
    for keyword, _, _ in keyword_scores[:max_links]:
        for link in sorted(keyword_map[keyword], key=lambda x: x['score'], reverse=True):
            if link['url'] not in seen_urls and len(matched_links) < max_links:
                matched_links.append(link)
                seen_urls.add(link['url'])
    
    # Fallback: Use top-scoring keywords from keyword_map
    if not matched_links:
        top_keywords = sorted(
            [(k, max((link['score'] for link in keyword_map[k]), default=0)) 
             for k in keyword_map if k != "error"], 
            key=lambda x: x[1], 
            reverse=True
        )[:max_links]
        for keyword, _ in top_keywords:
            for link in sorted(keyword_map[keyword], key=lambda x: x['score'], reverse=True):
                if link['url'] not in seen_urls and len(matched_links) < max_links:
                    matched_links.append(link)
                    seen_urls.add(link['url'])
    
    logger.info(f"Matched keywords: {[k for k, _, _ in keyword_scores]}")
    logger.info(f"Found {len(matched_links)} relevant links")
    if not matched_links and "error" in keyword_map:
        logger.warning("Returning error link due to no matches")
        return keyword_map["error"]
    if not matched_links:
        logger.warning(f"No links found for text: {text[:100]}...")
    return matched_links

def inject_links(response: str, user_prompt: str, keyword_map: Dict[str, List[Dict]], use_markdown: bool = True) -> str:
    """Append relevant links to the response based on user prompt and response, but only if not already present."""
    logger.info("Injecting links into response")
    # If response already contains a 'Relevant Links' section, do not add another
    if '**Relevant Links**' in response:
        logger.info("Response already contains a Relevant Links section; skipping injection.")
        return response
    text = f"{user_prompt} {response}"  # Combine for broader matching
    links = match_keywords(text, keyword_map)
    if not links:
        logger.info("No relevant links found")
        return response
    # Format links based on use_markdown flag
    if use_markdown:
        link_text = "\n\n**Relevant Links**:\n" + "\n".join(
            f"- [{link['title']}]({link['url']}) ({link['source']})" for link in links
        )
    else:
        # Plain URLs for non-markdown rendering
        link_text = "\n\nRelevant Links:\n" + "\n".join(
            #f"- {link['title']}: {link['url']} ({link['source']})" for link in links
            f"{link['url']}" for link in links
        )
    return response + link_text

def main():
    """Example usage."""
    keyword_map = load_keyword_map()
    test_cases = [
        ("What is BrainDrive?", "BrainDrive is a self-hosted, decentralized personal AI system."),
        ("What is a plugin?", "Plugins extend BrainDrive's functionality with custom features."),
        ("What does it mean to own AI?", "Owning AI with BrainDrive means controlling your AI system.")
    ]
    for prompt, response in test_cases:
        print(f"\nUser: {prompt}")
        updated_response = inject_links(response, prompt, keyword_map)
        print(f"Assistant: {updated_response}")

if __name__ == "__main__":
    main()