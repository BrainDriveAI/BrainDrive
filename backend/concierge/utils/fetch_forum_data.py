import requests
import json
import logging
import time
from datetime import datetime
import os

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

BASE_URL = "https://community.braindrive.ai"
FORUM_URL = BASE_URL
OUTPUT_DIR = "data/raw_forum_data"
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")

def fetch_json(url):
    try:
        response = requests.get(url, headers={"Accept": "application/json"})
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        logging.error(f"Error fetching {url}: {e}")
        return None

def fetch_topic_content(topic_id):
    url = f"{BASE_URL}/t/{topic_id}.json"
    data = fetch_json(url)
    if not data:
        return None
    return {
        "topic_id": data.get("id"),
        "title": data.get("title"),
        "original_poster": {
            "username": data.get("details", {}).get("created_by", {}).get("username"),
            "user_id": data.get("details", {}).get("created_by", {}).get("id")
        },
        "content": data.get("post_stream", {}).get("posts", [])[0].get("cooked") if data.get("post_stream", {}).get("posts") else "",
        "created_at": data.get("created_at"),
        "views": data.get("views"),
        "replies": data.get("posts_count", 0) - 1
    }

def fetch_all_topics(category_slug, category_id):
    topics = []
    page = 0
    while True:
        url = f"{BASE_URL}/c/{category_slug}/{category_id}.json?page={page}"
        data = fetch_json(url)
        if not data:
            break
        topic_list = data.get("topic_list", {}).get("topics", [])
        if not topic_list:
            break
        topics.extend(topic_list)
        page += 1
        if not data.get("topic_list", {}).get("more_topics_url"):
            break
        time.sleep(2)  # Rate limiting
    return topics

def fetch_forum_data():
    logging.info(f"Starting fetch and save process for {FORUM_URL}")
    logging.info(f"Fetching forum data from {FORUM_URL}")
    
    data = fetch_json(f"{FORUM_URL}/categories.json")
    if not data:
        return
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output_file = f"{OUTPUT_DIR}/forum_data_{TIMESTAMP}.json"
    categories_data = []
    
    for category in data.get("category_list", {}).get("categories", []):
        category_name = category.get("name")
        category_slug = category.get("slug")
        category_id = category.get("id")
        
        topics = fetch_all_topics(category_slug, category_id)
        topic_count = len(topics)
        logging.info(f"Fetching topics for category: {category_name} ({topic_count} topics)")
        
        category_data = {
            "category_name": category_name,
            "category_slug": category_slug,
            "category_id": category_id,
            "topics": []
        }
        
        for topic in topics:
            topic_id = topic.get("id")
            logging.info(f"Fetching content for topic: {topic.get('title')}")
            topic_content = fetch_topic_content(topic_id)
            if topic_content:
                category_data["topics"].append(topic_content)
            time.sleep(2)  # Rate limiting
        
        logging.info(f"Processed category: {category_name} with {len(category_data['topics'])} topics fetched")
        categories_data.append(category_data)
        
        # Flush category data to file
        with open(output_file, 'w') as f:
            json.dump(categories_data, f, indent=2)
        logging.info(f"Flushed category {category_name} to {output_file}")
    
    logging.info(f"Extracted {len(categories_data)} categories with {sum(len(c['topics']) for c in categories_data)} topics")
    logging.info(f"Saving raw data to {OUTPUT_DIR}")
    with open(output_file, 'w') as f:
        json.dump(categories_data, f, indent=2)
    logging.info(f"Raw data saved to {output_file}")
    logging.info(f"Completed fetch and save process. Data saved to {output_file}")

if __name__ == "__main__":
    fetch_forum_data()